import {
  BaseError, createPublicClient, decodeFunctionData, encodeFunctionData, erc20Abi, http,
  parseEventLogs, parseTransaction, recoverTransactionAddress, type Address, type Hex,
  type TransactionSerializedEIP1559,
} from "viem";
import { baseSepolia } from "viem/chains";
import { config, fetchLotAddress, nearProvider, nearView, type Finality } from "@quitclaim/shared";
import { address, finality, natural, object, parseEvidence, text, type HeistEvidence, type NearRef } from "./heist-evidence.ts";

type Transfer = { from: Address; to: Address; amount: bigint };
type Mined = {
  from: Address; to: Address | null; nonce: number; value: bigint; data: Hex;
  success: boolean; canonical: boolean; block: bigint; timestamp: bigint; transfers: Transfer[];
};
type Call = { receiver: string; predecessor: string; method: string; args: Record<string, unknown>; receiptId: string };
type NearHistory = {
  receiver: string; signer: string; success: boolean; value: string | null;
  calls: Call[]; logs: string[]; height: number; timestamp: bigint;
  outcomes: { id: string; success: boolean; value: string | null }[];
};
export type Observation = {
  chainId: number; codeHash: string; finality: Finality; fullAccessKeys: number;
  lot: { address: Address; token: Address; path: string; nextNonce: number; owner: string };
  derivedAddress: Address; nonce: number; safeHead: bigint;
  consumer: Mined; withdrawal: Mined; proof: NearHistory; sale: NearHistory;
  previousNonce: { kind: "available"; nonce: number } | { kind: "unavailable"; reason: string };
};
export type Replay = { kind: "nonce-consumed" | "incomplete"; message: string };
export type HeistIO = {
  observe: (e: HeistEvidence) => Promise<Observation>;
  replay: (raw: TransactionSerializedEIP1559) => Promise<Replay>;
  log: (line: string) => void;
};

const same = (a: string | null, b: string) => a?.toLowerCase() === b.toLowerCase();
const nearUrl = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;
const baseUrl = (hash: Hex) => `${config.evm.explorer}/tx/${hash}`;
const requireFact = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
const errorMessage = (e: unknown) => e instanceof BaseError ? e.details || e.shortMessage : e instanceof Error ? e.message : String(e);

function transfer(data: Hex) {
  const call = decodeFunctionData({ abi: erc20Abi, data });
  if (call.functionName !== "transfer") throw new Error("expected ERC-20 transfer");
  const [to, amount] = call.args;
  requireFact(amount > 0n && encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }).toLowerCase() === data.toLowerCase(), "invalid transfer amount or trailing calldata");
  return { to, amount };
}

const publicBase = createPublicClient({ chain: baseSepolia, transport: http(config.evm.rpcUrl, { retryCount: 0, timeout: 20_000 }) });

async function mined(hash: Hex): Promise<Mined> {
  const [tx, receipt] = await Promise.all([publicBase.getTransaction({ hash }), publicBase.getTransactionReceipt({ hash })]);
  const block = await publicBase.getBlock({ blockNumber: receipt.blockNumber });
  return {
    from: tx.from, to: tx.to, nonce: tx.nonce, value: tx.value, data: tx.input,
    success: receipt.status === "success", canonical: receipt.blockHash === block.hash && tx.blockHash === block.hash,
    block: receipt.blockNumber, timestamp: block.timestamp,
    transfers: parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs })
      .filter(log => same(log.address, tx.to ?? ""))
      .map(log => ({ from: log.args.from, to: log.args.to, amount: log.args.value })),
  };
}

async function history(ref: NearRef): Promise<NearHistory> {
  const provider = nearProvider();
  const result = await provider.viewTransactionStatusWithReceipts({ txHash: ref.hash, accountId: ref.signer, waitUntil: "FINAL" });
  const r = object(result, "NEAR transaction");
  const tx = object(r.transaction, "NEAR transaction body");
  requireFact(tx.hash === ref.hash, "NEAR RPC returned a different transaction");
  const root = object(r.transaction_outcome, "NEAR transaction outcome");
  const block = await provider.viewBlock({ blockId: text(root.block_hash, "NEAR transaction block") });
  if (!Array.isArray(r.receipts) || !Array.isArray(r.receipts_outcome)) throw new Error("NEAR historical receipts unavailable");
  const calls: Call[] = [];
  for (const raw of r.receipts) {
    const receipt = object(raw, "receipt");
    const body = object(receipt.receipt, "receipt body");
    if (!("Action" in body)) continue;
    const actionReceipt = object(body.Action, "action receipt");
    if (!Array.isArray(actionReceipt.actions)) throw new Error("missing receipt actions");
    for (const rawAction of actionReceipt.actions) {
      const action = object(rawAction, "action");
      if (!("FunctionCall" in action)) continue;
      const call = object(action.FunctionCall, "function call");
      const method = text(call.method_name, "method");
      if (!["prove", "verify_foreign_transaction", "on_proved", "buy"].includes(method)) continue;
      calls.push({ receiver: text(receipt.receiver_id, "receiver"), predecessor: text(receipt.predecessor_id, "predecessor"),
        method, receiptId: text(receipt.receipt_id, "receipt ID"),
        args: object(JSON.parse(Buffer.from(text(call.args, "call args"), "base64").toString()), "call args") });
    }
  }
  const value = (status: unknown): string | null => {
    const s = object(status, "execution status");
    return typeof s.SuccessValue === "string" ? Buffer.from(s.SuccessValue, "base64").toString() : null;
  };
  const logs: string[] = [];
  const outcomes = r.receipts_outcome.map(raw => {
    const receipt = object(raw, "receipt outcome");
    const outcome = object(receipt.outcome, "outcome");
    if (!Array.isArray(outcome.logs)) throw new Error("missing outcome logs");
    if (outcome.executor_id === tx.receiver_id) logs.push(...outcome.logs.map(log => text(log, "log")));
    const v = value(outcome.status);
    return { id: text(receipt.id, "outcome ID"), success: v !== null || "SuccessReceiptId" in object(outcome.status, "status"), value: v };
  });
  const returned = value(r.status);
  return { receiver: text(tx.receiver_id, "transaction receiver"), signer: text(tx.signer_id, "transaction signer"),
    success: returned !== null, value: returned, calls, logs, outcomes,
    height: block.header.height, timestamp: BigInt(block.header.timestamp_nanosec) / 1_000_000_000n };
}

async function observe(e: HeistEvidence): Promise<Observation> {
  const provider = nearProvider();
  const [rawLot, rawConfig, account, keys, chainId, nonce, safe, consumer, withdrawal, proof, sale] = await Promise.all([
    nearView<unknown>(e.contract, "get_lot", { id: e.lot.id }), nearView<unknown>(e.contract, "get_config", {}),
    provider.viewAccount({ accountId: e.contract }), provider.viewAccessKeyList({ accountId: e.contract }),
    publicBase.getChainId(), publicBase.getTransactionCount({ address: e.lot.address, blockTag: "latest" }),
    publicBase.getBlock({ blockTag: "safe" }), mined(e.consumingTx), mined(e.buyerWithdrawal),
    history(e.proof).catch(error => { throw new Error(`NEAR proof history incomplete: ${nearUrl(e.proof.hash)}\n${errorMessage(error)}`); }),
    history(e.sale).catch(error => { throw new Error(`NEAR sale history incomplete: ${nearUrl(e.sale.hash)}\n${errorMessage(error)}`); }),
  ]);
  const l = object(rawLot, "lot");
  const c = object(rawConfig, "config");
  requireFact(c.signer === config.near.mpcSigner, "unexpected MPC signer");
  const lot = { address: address(l.address, "lot.address"), token: address(l.token, "lot.token"), path: text(l.path, "lot.path"),
    nextNonce: natural(l.next_nonce, "lot.next_nonce"), owner: text(l.owner, "lot.owner") };
  let previousNonce: Observation["previousNonce"];
  try { previousNonce = { kind: "available", nonce: await publicBase.getTransactionCount({ address: e.lot.address, blockNumber: consumer.block - 1n }) }; }
  catch (error) { previousNonce = { kind: "unavailable", reason: errorMessage(error) }; }
  if (safe.number === null) throw new Error("Base Safe head unavailable");
  return { chainId, codeHash: account.code_hash, finality: finality(c.finality),
    fullAccessKeys: keys.keys.filter(key => key.access_key.permission === "FullAccess").length,
    lot, derivedAddress: await fetchLotAddress(e.contract, lot.path), nonce, safeHead: safe.number,
    consumer, withdrawal, proof, sale, previousNonce };
}

async function replay(raw: TransactionSerializedEIP1559): Promise<Replay> {
  try {
    const hash = await publicBase.sendRawTransaction({ serializedTransaction: raw });
    return { kind: "incomplete", message: `RPC accepted transaction ${hash}; rejection was not demonstrated` };
  } catch (error) {
    return replayError(error);
  }
}

export function replayError(error: unknown): Replay {
  const message = errorMessage(error);
  return { kind: /\bnonce too low\b|\bnonce has already been used\b/i.test(message) ? "nonce-consumed" : "incomplete", message };
}

function successfulCall(h: NearHistory, contract: string, method: string) {
  requireFact(h.success && h.receiver === contract, `NEAR ${method} transaction failed or targets another contract`);
  const call = h.calls.find(c => c.receiver === contract && c.predecessor === h.signer && c.method === method);
  if (!call || !h.outcomes.some(o => o.id === call.receiptId && o.success)) throw new Error(`missing successful ${method} receipt`);
  return call;
}

export async function verifyHeist(e: HeistEvidence, io: HeistIO = { observe, replay, log: console.log }): Promise<void> {
  const tx = parseTransaction(e.retained);
  requireFact(tx.chainId === config.evm.chainId && e.chainId === config.evm.chainId, "retained transaction uses the wrong chain");
  const sender = await recoverTransactionAddress({ serializedTransaction: e.retained });
  requireFact(same(sender, e.lot.address), "retained signature is not from the lot");
  requireFact(same(tx.to ?? null, e.lot.token) && (tx.value ?? 0n) === 0n, "retained transaction has the wrong token or native value");
  const claim = transfer(tx.data ?? "0x");
  requireFact(same(claim.to, e.seller.evm), "retained transfer does not pay the seller");
  const nonce = natural(tx.nonce, "retained nonce");
  io.log(`Retained transfer: ${sender} -> ${e.seller.evm}, ${claim.amount} token units, nonce ${nonce}`);
  const o = await io.observe(e);
  requireFact(o.chainId === config.evm.chainId && o.codeHash === e.codeHash && o.finality === e.finality, "chain, contract code hash, or finality differs from published evidence");
  requireFact(same(o.lot.address, sender) && same(o.derivedAddress, sender) && same(o.lot.token, e.lot.token), "live lot or derived-address binding differs");
  requireFact(o.lot.nextNonce > nonce && o.nonce > nonce, "nonce is not consumed on both NEAR and Base; replay skipped");
  const c = o.consumer;
  requireFact(c.success && c.canonical && same(c.from, sender) && c.nonce === nonce, "consuming transaction is not a canonical successful transaction at the retained nonce");
  requireFact(same(c.to, sender) && c.value === 0n && c.data === "0x", "consuming transaction is not the recorded nonce burn");
  requireFact(o.safeHead >= c.block, "consuming block has not reached Base Safe; replay skipped");
  if (o.previousNonce.kind === "available") requireFact(o.previousNonce.nonce === nonce, "retained nonce was not unused immediately before the consuming block");
  const p = successfulCall(o.proof, e.contract, "prove");
  requireFact(p.args.id === e.lot.id && o.proof.signer === e.proof.signer && o.proof.value === "true", "NEAR proof does not prove this lot");
  const mpc = o.proof.calls.find(call => call.receiver === config.near.mpcSigner && call.predecessor === e.contract && call.method === "verify_foreign_transaction");
  if (!mpc) throw new Error("proof has no MPC verification receipt");
  const request = object(mpc.args.request, "MPC request");
  const base = object(object(request.request, "foreign request").Base, "Base request");
  requireFact(base.tx_id === e.consumingTx.slice(2) && base.finality === e.finality && request.domain_id === config.near.foreignTxDomain,
    "MPC proof is not bound to the recorded consuming transaction");
  requireFact(o.proof.outcomes.some(outcome => outcome.id === mpc.receiptId && outcome.success), "MPC verification receipt failed");
  const callback = o.proof.calls.find(call => call.receiver === e.contract && call.predecessor === e.contract && call.method === "on_proved" && call.args.id === e.lot.id && call.args.nonce === nonce);
  requireFact(!!callback && o.proof.outcomes.some(outcome => outcome.id === callback.receiptId && outcome.value === "true"), "nonce proof callback did not succeed");
  const sale = successfulCall(o.sale, e.contract, "buy");
  requireFact(sale.args.id === e.lot.id && o.sale.signer === e.buyer.near && o.sale.signer === e.sale.signer && e.seller.near !== e.buyer.near, "sale does not match this buyer and lot");
  const changed = o.sale.logs.filter(log => log.startsWith("EVENT_JSON:")).some(log => {
    const event = object(JSON.parse(log.slice("EVENT_JSON:".length)), "NEP-171 event");
    if (event.standard !== "nep171" || event.event !== "nft_transfer" || !Array.isArray(event.data)) return false;
    return event.data.some(value => { const d = object(value, "transfer event"); return d.old_owner_id === e.seller.near && d.new_owner_id === e.buyer.near && Array.isArray(d.token_ids) && d.token_ids.includes(String(e.lot.id)); });
  });
  requireFact(changed, "sale has no matching seller-to-buyer title transfer");
  const w = o.withdrawal;
  requireFact(w.success && w.canonical && same(w.from, sender) && same(w.to, e.lot.token) && w.value === 0n && w.nonce > nonce, "buyer withdrawal is not a canonical successful transfer from the lot");
  const paid = transfer(w.data);
  requireFact(same(paid.to, e.buyer.evm) && w.transfers.some(t => same(t.from, sender) && same(t.to, e.buyer.evm) && t.amount === paid.amount), "buyer withdrawal did not pay the named buyer");
  requireFact(c.timestamp <= o.proof.timestamp && o.proof.height < o.sale.height && o.sale.timestamp <= w.timestamp, "proof, sale, and buyer withdrawal are not in handover order");
  io.log(`PASS nonce consumed: NEAR ${o.lot.nextNonce}, Base ${o.nonce}; current owner ${o.lot.owner}`);
  io.log(`PASS canonical nonce burn, now Base Safe: ${baseUrl(e.consumingTx)}`);
  io.log(`PASS NEAR MPC proof: ${nearUrl(e.proof.hash)}`);
  io.log(`PASS sale ${e.seller.near} -> ${e.buyer.near}: ${nearUrl(e.sale.hash)}`);
  io.log(`PASS buyer received ${paid.amount} token units: ${baseUrl(e.buyerWithdrawal)}`);
  io.log(o.previousNonce.kind === "available" ? `PASS historical nonce before consumption: ${o.previousNonce.nonce}` : `UNAVAILABLE historical nonce: ${o.previousNonce.reason}`);
  io.log(`Evidence recorded ${e.recordedAt}: ${e.finality}; recorded full-access keys ${e.recordedFullAccessKeys ?? "unknown"}. Current ${o.finality}, ${o.fullAccessKeys} full-access key(s).`);
  const result = await io.replay(e.retained);
  if (result.kind !== "nonce-consumed") throw new Error(`Replay incomplete: ${result.message}`);
  io.log(`PASS replay rejected for consumed nonce: ${result.message}`);
}

if (import.meta.main) {
  try {
    const args = Bun.argv.slice(2);
    if (args.length > 1) throw new Error("usage: bun run heist [evidence.json]");
    const file = args[0] ?? new URL("../../../reports/heist.json", import.meta.url).pathname;
    await verifyHeist(parseEvidence(await Bun.file(file).json()));
  } catch (error) {
    console.error(`INCOMPLETE heist: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
