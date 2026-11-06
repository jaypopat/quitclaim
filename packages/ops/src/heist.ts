import { logger } from "./logger.ts";
import {
  BaseError,
  createPublicClient,
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  http,
  parseEventLogs,
  parseTransaction,
  recoverTransactionAddress,
  type Address,
  type Hex,
  type TransactionSerializedEIP1559,
} from "viem";
import { baseSepolia } from "viem/chains";
import { JsonRpcProvider } from "near-api-js";
import { config, fetchLotAddress, type Finality } from "@quitclaim/shared";
import { txUrl as baseTxUrl } from "./base.ts";
import {
  parseEvidence,
  type HeistEvidence,
  type NearRef,
} from "./heist-evidence.ts";
import { codeHash, fullAccessKeys, nearTxUrl, view } from "./near.ts";

type Transfer = { from: Address; to: Address; amount: bigint };
type Mined = {
  from: Address;
  to: Address | null;
  nonce: number;
  value: bigint;
  data: Hex;
  success: boolean;
  canonical: boolean;
  block: bigint;
  timestamp: bigint;
  transfers: Transfer[];
};
type Call = {
  receiver: string;
  predecessor: string;
  method: string;
  args: Record<string, unknown>;
  ok: boolean;
  value: string | null;
};
type VerifyArgs = {
  request: {
    domain_id: number;
    request: { Base: { tx_id: string; finality: Finality } };
  };
};
type Nep171Event = {
  standard: string;
  event: string;
  data: { old_owner_id: string; new_owner_id: string; token_ids: string[] }[];
};
type NearHistory = {
  receiver: string;
  signer: string;
  success: boolean;
  value: string | null;
  calls: Call[];
  logs: string[];
  height: number;
  timestamp: bigint;
};
export type Observation = {
  chainId: number;
  codeHash: string;
  finality: Finality;
  fullAccessKeys: number;
  lot: {
    address: Address;
    token: Address;
    path: string;
    nextNonce: number;
    owner: string;
  };
  derivedAddress: Address;
  nonce: number;
  safeHead: bigint;
  consumer: Mined;
  withdrawal: Mined;
  proof: NearHistory;
  sale: NearHistory;
  tokenInfo: { symbol: string; decimals: number };
};
export type Replay = { kind: "nonce-consumed" | "incomplete"; message: string };
export type HeistIO = {
  observe: (e: HeistEvidence) => Promise<Observation>;
  replay: (raw: TransactionSerializedEIP1559) => Promise<Replay>;
  log: (line: string) => void;
};

const same = (a: string | null, b: string) =>
  a?.toLowerCase() === b.toLowerCase();
function requireFact(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const errorMessage = (e: unknown) =>
  e instanceof BaseError
    ? e.details || e.shortMessage
    : e instanceof Error
      ? e.message
      : String(e);

function transfer(data: Hex) {
  const call = decodeFunctionData({ abi: erc20Abi, data });
  if (call.functionName !== "transfer")
    throw new Error("expected ERC-20 transfer");
  const [to, amount] = call.args;
  requireFact(amount > 0n, "transfer amount must be positive");
  const encoded = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, amount],
  });
  requireFact(
    encoded.toLowerCase() === data.toLowerCase(),
    "transfer has trailing calldata",
  );
  return { to, amount };
}

const publicBase = createPublicClient({
  chain: baseSepolia,
  transport: http(config.evm.rpcUrl, { retryCount: 0, timeout: 20_000 }),
});

async function mined(hash: Hex): Promise<Mined> {
  const [tx, receipt] = await Promise.all([
    publicBase.getTransaction({ hash }),
    publicBase.getTransactionReceipt({ hash }),
  ]);
  const block = await publicBase.getBlock({ blockNumber: receipt.blockNumber });
  return {
    from: tx.from,
    to: tx.to,
    nonce: tx.nonce,
    value: tx.value,
    data: tx.input,
    success: receipt.status === "success",
    canonical: receipt.blockHash === block.hash && tx.blockHash === block.hash,
    block: receipt.blockNumber,
    timestamp: block.timestamp,
    transfers: parseEventLogs({
      abi: erc20Abi,
      eventName: "Transfer",
      logs: receipt.logs,
    })
      .filter((log) => same(log.address, tx.to ?? ""))
      .map((log) => ({
        from: log.args.from,
        to: log.args.to,
        amount: log.args.value,
      })),
  };
}

/** The live node prunes old receipts, so transaction history comes from an archival node. */
const archive = new JsonRpcProvider({ url: config.near.archivalRpcUrl });
type TxStatus = Awaited<
  ReturnType<typeof archive.viewTransactionStatusWithReceipts>
>;
type Status =
  | TxStatus["status"]
  | TxStatus["receipts_outcome"][number]["outcome"]["status"];
const traced = ["prove", "verify_foreign_transaction", "on_proved", "buy"];

const successValue = (status: Status) =>
  typeof status === "object" && "SuccessValue" in status
    ? Buffer.from(status.SuccessValue, "base64").toString()
    : null;

async function history(ref: NearRef): Promise<NearHistory> {
  const r = await archive.viewTransactionStatusWithReceipts({
    txHash: ref.hash,
    accountId: ref.signer,
    waitUntil: "FINAL",
  });
  if (!("receipts" in r))
    throw new Error("NEAR historical receipts unavailable");
  requireFact(
    r.transaction.hash === ref.hash,
    "NEAR RPC returned a different transaction",
  );
  const block = await archive.viewBlock({
    blockId: r.transaction_outcome.block_hash,
  });
  const logs = r.receipts_outcome
    .filter((o) => o.outcome.executor_id === r.transaction.receiver_id)
    .flatMap((o) => o.outcome.logs);
  const outcomes = new Map(
    r.receipts_outcome.map((o) => [o.id, o.outcome.status]),
  );
  const calls = r.receipts.flatMap((receipt) => {
    if (!("Action" in receipt.receipt)) return [];
    return receipt.receipt.Action.actions.flatMap((action): Call[] => {
      if (
        typeof action !== "object" ||
        !("FunctionCall" in action) ||
        !traced.includes(action.FunctionCall.method_name)
      )
        return [];
      const status = outcomes.get(receipt.receipt_id);
      if (!status) throw new Error("missing call outcome");
      const value = successValue(status);
      return [
        {
          receiver: receipt.receiver_id,
          predecessor: receipt.predecessor_id,
          method: action.FunctionCall.method_name,
          ok:
            value !== null ||
            (typeof status === "object" && "SuccessReceiptId" in status),
          value,
          args: JSON.parse(
            Buffer.from(action.FunctionCall.args, "base64").toString(),
          ),
        },
      ];
    });
  });
  const returned = successValue(r.status);
  return {
    receiver: r.transaction.receiver_id,
    signer: r.transaction.signer_id,
    success: returned !== null,
    value: returned,
    calls,
    logs,
    height: block.header.height,
    timestamp: BigInt(block.header.timestamp_nanosec) / 1_000_000_000n,
  };
}

async function observe(e: HeistEvidence): Promise<Observation> {
  const [
    lot,
    deployed,
    hash,
    keys,
    chainId,
    nonce,
    safe,
    consumer,
    withdrawal,
    proof,
    sale,
    symbol,
    decimals,
  ] = await Promise.all([
    view(e.contract, "get_lot", { id: e.lot.id }),
    view(e.contract, "get_config", {}),
    codeHash(e.contract),
    fullAccessKeys(e.contract),
    publicBase.getChainId(),
    publicBase.getTransactionCount({
      address: e.lot.address,
      blockTag: "latest",
    }),
    publicBase.getBlock({ blockTag: "safe" }),
    mined(e.consumingTx),
    mined(e.buyerWithdrawal),
    history(e.proof).catch((error) => {
      throw new Error(
        `NEAR proof history unavailable: ${nearTxUrl(e.proof.hash)}\n${errorMessage(error)}`,
      );
    }),
    history(e.sale).catch((error) => {
      throw new Error(
        `NEAR sale history unavailable: ${nearTxUrl(e.sale.hash)}\n${errorMessage(error)}`,
      );
    }),
    publicBase.readContract({
      address: e.lot.token,
      abi: erc20Abi,
      functionName: "symbol",
    }),
    publicBase.readContract({
      address: e.lot.token,
      abi: erc20Abi,
      functionName: "decimals",
    }),
  ]);
  requireFact(lot, `no lot ${e.lot.id} on ${e.contract}`);
  requireFact(
    deployed.signer === config.near.mpcSigner,
    "unexpected MPC signer",
  );
  requireFact(safe.number !== null, "Base Safe head unavailable");
  return {
    chainId,
    codeHash: hash,
    finality: deployed.finality,
    fullAccessKeys: keys.length,
    lot: {
      address: lot.address as Address,
      token: lot.token as Address,
      path: lot.path,
      nextNonce: lot.next_nonce,
      owner: lot.owner,
    },
    derivedAddress: await fetchLotAddress(e.contract, lot.path),
    nonce,
    safeHead: safe.number,
    consumer,
    withdrawal,
    proof,
    sale,
    tokenInfo: { symbol, decimals },
  };
}

async function replay(raw: TransactionSerializedEIP1559): Promise<Replay> {
  try {
    const hash = await publicBase.sendRawTransaction({
      serializedTransaction: raw,
    });
    return {
      kind: "incomplete",
      message: `RPC accepted transaction ${hash}; rejection was not demonstrated`,
    };
  } catch (error) {
    return replayError(error);
  }
}

export function replayError(error: unknown): Replay {
  const message = errorMessage(error);
  return {
    kind: /\bnonce too low\b|\bnonce has already been used\b/i.test(message)
      ? "nonce-consumed"
      : "incomplete",
    message,
  };
}

function successfulCall(
  history: NearHistory,
  contract: string,
  method: string,
) {
  requireFact(history.success, `NEAR ${method} transaction failed`);
  requireFact(
    history.receiver === contract,
    `NEAR ${method} targets another contract`,
  );
  const call = history.calls.find(
    (call) =>
      call.receiver === contract &&
      call.predecessor === history.signer &&
      call.method === method,
  );
  if (!call?.ok) throw new Error(`missing successful ${method} receipt`);
  return call;
}

async function checkSignedTransfer(evidence: HeistEvidence) {
  const transaction = parseTransaction(evidence.retained);
  requireFact(
    transaction.chainId === config.evm.chainId,
    "signed withdrawal uses the wrong chain",
  );
  const sender = await recoverTransactionAddress({
    serializedTransaction: evidence.retained,
  });
  requireFact(
    same(sender, evidence.lot.address),
    "retained signature is not from the lot",
  );
  requireFact(
    same(transaction.to ?? null, evidence.lot.token),
    "signed withdrawal targets another token",
  );
  requireFact(
    (transaction.value ?? 0n) === 0n,
    "signed withdrawal sends native ETH",
  );
  const payment = transfer(transaction.data ?? "0x");
  requireFact(
    same(payment.to, evidence.seller.evm),
    "signed withdrawal does not pay the seller",
  );
  return {
    sender,
    nonce: transaction.nonce ?? 0,
    amount: payment.amount,
  };
}

type SignedTransfer = Awaited<ReturnType<typeof checkSignedTransfer>>;

function checkLot(
  evidence: HeistEvidence,
  observed: Observation,
  signed: SignedTransfer,
) {
  requireFact(
    observed.chainId === config.evm.chainId,
    "RPC is on the wrong chain",
  );
  requireFact(
    observed.codeHash === evidence.codeHash,
    "deployed code differs from the published evidence",
  );
  requireFact(
    observed.finality === evidence.finality,
    "contract finality differs from the published evidence",
  );
  requireFact(
    same(observed.lot.address, signed.sender),
    "live lot address differs from the signature",
  );
  requireFact(
    same(observed.derivedAddress, signed.sender),
    "MPC-derived address differs from the signature",
  );
  requireFact(
    same(observed.lot.token, evidence.lot.token),
    "live lot uses another token",
  );
  requireFact(
    observed.lot.nextNonce > signed.nonce,
    "NEAR has not confirmed nonce consumption; replay skipped",
  );
  requireFact(
    observed.nonce > signed.nonce,
    "Base nonce is unconsumed; replay skipped",
  );
}

function checkBurn(observed: Observation, signed: SignedTransfer) {
  const burn = observed.consumer;
  requireFact(burn.success, "burn transaction reverted");
  requireFact(burn.canonical, "burn block is not canonical");
  requireFact(
    same(burn.from, signed.sender),
    "burn was sent by another account",
  );
  requireFact(burn.nonce === signed.nonce, "burn consumed another nonce");
  requireFact(same(burn.to, signed.sender), "burn is not a self-transfer");
  requireFact(burn.value === 0n, "burn sends ETH");
  requireFact(burn.data === "0x", "burn has unexpected calldata");
  requireFact(
    observed.safeHead >= burn.block,
    "burn has not reached Base Safe; replay skipped",
  );
}

function checkProof(
  evidence: HeistEvidence,
  observed: Observation,
  nonce: number,
) {
  const proof = observed.proof;
  const call = successfulCall(proof, evidence.contract, "prove");
  requireFact(call.args.id === evidence.lot.id, "proof concerns another lot");
  requireFact(
    proof.signer === evidence.proof.signer,
    "proof signer differs from the evidence",
  );
  requireFact(proof.value === "true", "proof did not consume a nonce");
  const mpc = proof.calls.find(
    (call) =>
      call.receiver === config.near.mpcSigner &&
      call.predecessor === evidence.contract &&
      call.method === "verify_foreign_transaction",
  );
  if (!mpc?.ok) throw new Error("missing successful MPC verification receipt");
  const { request } = mpc.args as VerifyArgs;
  const base = request.request.Base;
  requireFact(
    base.tx_id === evidence.consumingTx.slice(2),
    "MPC verified another consuming transaction",
  );
  requireFact(
    base.finality === evidence.finality,
    "MPC proof uses another finality",
  );
  requireFact(
    request.domain_id === config.near.foreignTxDomain,
    "MPC proof uses another domain",
  );
  const callback = proof.calls.find(
    (call) =>
      call.receiver === evidence.contract &&
      call.predecessor === evidence.contract &&
      call.method === "on_proved" &&
      call.args.id === evidence.lot.id &&
      call.args.nonce === nonce,
  );
  requireFact(
    callback?.ok === true && callback.value === "true",
    "nonce proof callback did not succeed",
  );
  requireFact(
    observed.consumer.timestamp <= proof.timestamp,
    "proof predates the burn",
  );
}

function checkSale(evidence: HeistEvidence, observed: Observation) {
  const sale = observed.sale;
  const call = successfulCall(sale, evidence.contract, "buy");
  requireFact(
    call.args.id === evidence.lot.id,
    "purchase concerns another lot",
  );
  requireFact(
    sale.signer === evidence.buyer.near,
    "purchase was signed by another buyer",
  );
  requireFact(
    sale.signer === evidence.sale.signer,
    "purchase signer differs from the evidence",
  );
  requireFact(
    evidence.seller.near !== evidence.buyer.near,
    "buyer and seller are the same account",
  );
  const titleChanged = sale.logs
    .filter((log) => log.startsWith("EVENT_JSON:"))
    .some((log) => {
      const event: Nep171Event = JSON.parse(log.slice("EVENT_JSON:".length));
      if (event.standard !== "nep171" || event.event !== "nft_transfer")
        return false;
      return event.data.some(
        (transfer) =>
          transfer.old_owner_id === evidence.seller.near &&
          transfer.new_owner_id === evidence.buyer.near &&
          transfer.token_ids.includes(String(evidence.lot.id)),
      );
    });
  requireFact(
    titleChanged,
    "purchase has no matching seller-to-buyer title transfer",
  );
  requireFact(
    observed.proof.height < sale.height,
    "purchase predates the proof",
  );
}

function checkBuyerPaid(
  evidence: HeistEvidence,
  observed: Observation,
  signed: SignedTransfer,
) {
  const withdrawal = observed.withdrawal;
  requireFact(withdrawal.success, "buyer withdrawal reverted");
  requireFact(withdrawal.canonical, "buyer withdrawal block is not canonical");
  requireFact(
    same(withdrawal.from, signed.sender),
    "buyer withdrawal came from another address",
  );
  requireFact(
    same(withdrawal.to, evidence.lot.token),
    "buyer withdrawal targets another token",
  );
  requireFact(withdrawal.value === 0n, "buyer withdrawal sends native ETH");
  requireFact(
    withdrawal.nonce > signed.nonce,
    "buyer withdrawal predates nonce consumption",
  );
  const payment = transfer(withdrawal.data);
  requireFact(
    same(payment.to, evidence.buyer.evm),
    "withdrawal pays another recipient",
  );
  requireFact(
    withdrawal.transfers.some(
      (transfer) =>
        same(transfer.from, signed.sender) &&
        same(transfer.to, evidence.buyer.evm) &&
        transfer.amount === payment.amount,
    ),
    "missing matching token payment event",
  );
  requireFact(
    observed.sale.timestamp <= withdrawal.timestamp,
    "buyer withdrawal predates the purchase",
  );
  return payment.amount;
}

function tokenAmount(amount: bigint, token: Observation["tokenInfo"]) {
  const precision = Math.min(token.decimals, 2);
  const divisor = 10n ** BigInt(token.decimals - precision);
  const rounded = (amount + divisor / 2n) / divisor;
  return `${formatUnits(rounded, precision)} ${token.symbol}`;
}

export async function verifyHeist(
  evidence: HeistEvidence,
  io: HeistIO = { observe, replay, log: console.log },
): Promise<void> {
  io.log("Quitclaim heist: can Alice still spend from the lot she sold?");
  io.log(`Alice (seller): ${evidence.seller.near}`);
  io.log(`Bob (buyer): ${evidence.buyer.near}`);
  const signed = await checkSignedTransfer(evidence);
  const observed = await io.observe(evidence);
  checkLot(evidence, observed, signed);
  io.log(
    `Alice kept a signed withdrawal for about ${tokenAmount(signed.amount, observed.tokenInfo)}, Base nonce ${signed.nonce}.`,
  );

  checkBurn(observed, signed);
  io.log(
    `PASS nonce ${signed.nonce} burned on Base: ${baseTxUrl(evidence.consumingTx)}`,
  );
  checkProof(evidence, observed, signed.nonce);
  io.log(`PASS NEAR MPC verified the burn: ${nearTxUrl(evidence.proof.hash)}`);
  checkSale(evidence, observed);
  io.log(`PASS Bob bought Alice's title: ${nearTxUrl(evidence.sale.hash)}`);
  const amount = checkBuyerPaid(evidence, observed, signed);
  io.log(
    `PASS Bob withdrew about ${tokenAmount(amount, observed.tokenInfo)}: ${baseTxUrl(evidence.buyerWithdrawal)}`,
  );

  io.log("Broadcasting Alice's signed withdrawal once...");
  const result = await io.replay(evidence.retained);
  if (result.kind !== "nonce-consumed")
    throw new Error(`Replay failed: ${result.message}`);
  io.log(`Base rejected it: ${result.message}`);
  io.log(
    `PASS Alice's retained withdrawal was rejected. Current owner: ${observed.lot.owner}.`,
  );
  const policy =
    observed.fullAccessKeys === 0
      ? "contract frozen"
      : `contract upgradeable, ${observed.fullAccessKeys} full-access ${observed.fullAccessKeys === 1 ? "key" : "keys"}`;
  io.log(`Evidence: ${evidence.finality} MPC finality; ${policy}.`);
}

if (import.meta.main) {
  try {
    const args = Bun.argv.slice(2);
    if (args.length > 1)
      throw new Error("usage: bun run heist [evidence.json]");
    const file =
      args[0] ??
      new URL("../../../reports/heist.json", import.meta.url).pathname;
    await verifyHeist(parseEvidence(await Bun.file(file).json()));
  } catch (error) {
    logger.error({ err: error, command: "heist" }, "FAIL heist");
    process.exitCode = 1;
  }
}
