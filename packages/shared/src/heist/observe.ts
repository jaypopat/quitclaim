import {
  BaseError,
  createPublicClient,
  erc20Abi,
  http,
  parseEventLogs,
  type Address,
  type Hex,
  type TransactionSerializedEIP1559,
} from "viem";
import { baseSepolia } from "viem/chains";
import { base64Decode, bytesToString, JsonRpcProvider } from "near-api-js";
import { fetchLotAddress } from "../address.ts";
import { config } from "../config.ts";
import type { Finality } from "../lot.gen.ts";
import { codeHash, fullAccessKeys, nearTxUrl, nearView } from "../near.ts";
import { z } from "zod";
import type { HeistEvidence, NearRef } from "./evidence.ts";

/** Only the fields the heist reads, so evidence from an older deploy of the contract still parses. */
const lotFacts = z
  .object({
    address: z.string(),
    token: z.string(),
    path: z.string(),
    next_nonce: z.number().int().nonnegative(),
    owner: z.string(),
  })
  .nullable();

/** Reads what the heist checks from public NEAR and Base RPCs. No keys. */
export type Transfer = { from: Address; to: Address; amount: bigint };
export type Mined = {
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
export type Call = {
  receiver: string;
  predecessor: string;
  method: string;
  args: Record<string, unknown>;
  ok: boolean;
  value: string | null;
};
export type NearHistory = {
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
export const same = (a: string | null, b: string) =>
  a?.toLowerCase() === b.toLowerCase();
export function requireFact(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}
const errorMessage = (e: unknown) =>
  e instanceof BaseError
    ? e.details || e.shortMessage
    : e instanceof Error
      ? e.message
      : String(e);

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
    ? bytesToString(base64Decode(status.SuccessValue))
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
            bytesToString(base64Decode(action.FunctionCall.args)),
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

export async function observe(e: HeistEvidence): Promise<Observation> {
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
    nearView(e.contract, "get_lot", { id: e.lot.id }).then((v) =>
      lotFacts.parse(v),
    ),
    nearView<{ signer: string; finality: Finality }>(
      e.contract,
      "get_config",
      {},
    ),
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

export async function replay(
  raw: TransactionSerializedEIP1559,
): Promise<Replay> {
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
