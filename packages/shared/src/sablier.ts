/**
 * Sablier Lockup v4 on Base Sepolia, using the ABI and deployment address Sablier publishes in its
 * `sablier` package. A lot's value comes from a stream whose recipient is the lot address. These
 * are the reads anyone can make; the funder's writes live in the sdk.
 */
import {
  parseEventLogs,
  type Address,
  type Hex,
  type Log,
  type TransactionReceipt,
} from "viem";
import { sablier } from "sablier";
import { release } from "sablier/evm/releases/lockup/v4.0";
import { baseClient } from "./base.ts";
import { config } from "./config.ts";
import type { CreationLog } from "./lot.gen.ts";

export const lockupAbi = release.abi.SablierLockup;
const deployment = sablier.contracts.get({
  chainId: config.evm.chainId,
  contractName: "SablierLockup",
  release,
});
if (!deployment)
  throw new Error(
    `no Sablier Lockup v4.0 deployment on chain ${config.evm.chainId}`,
  );

export const LOCKUP = deployment.address as Address;

export const lockup = { address: LOCKUP, abi: lockupAbi } as const;
const bare = (h: string) => h.replace(/^0x/, "").toLowerCase();

/** The log exactly as MPC extracts it, which is what `mint_proven` takes. */
export function toCreationLog(log: Log): CreationLog {
  return {
    removed: log.removed,
    log_index: Number(log.logIndex),
    transaction_index: Number(log.transactionIndex),
    transaction_hash: bare(log.transactionHash!),
    block_hash: bare(log.blockHash!),
    block_number: Number(log.blockNumber),
    address: bare(log.address),
    data: log.data,
    topics: log.topics.map((t) => bare(t!)),
  };
}

/** A linear stream as its creation transaction set it up, with the log `mint_proven` takes. */
export type StreamCreation = {
  id: bigint;
  block: bigint;
  recipient: Address;
  token: Address;
  deposit: bigint;
  startSec: number;
  endSec: number;
  cancelable: boolean;
  transferable: boolean;
  log: CreationLog;
};

export function streamCreated(receipt: TransactionReceipt): StreamCreation {
  const [created] = parseEventLogs({
    abi: lockupAbi,
    logs: receipt.logs,
    eventName: "CreateLockupLinearStream",
  }).filter((l) => l.address.toLowerCase() === LOCKUP.toLowerCase());
  if (!created)
    throw new Error(
      `${receipt.transactionHash} did not create a Sablier linear stream`,
    );
  const { streamId, commonParams: p } = created.args;
  return {
    id: streamId,
    block: receipt.blockNumber,
    recipient: p.recipient,
    token: p.token,
    deposit: p.depositAmount,
    startSec: p.timestamps.start,
    endSec: p.timestamps.end,
    cancelable: p.cancelable,
    transferable: p.transferable,
    log: toCreationLog(created),
  };
}

export async function fetchStreamCreation(tx: Hex) {
  return streamCreated(await baseClient.getTransactionReceipt({ hash: tx }));
}

export type TitleSearch = {
  recipientIsLot: boolean;
  cancelable: boolean;
  transferable: boolean;
  tokenMatches: boolean;
  clean: boolean;
};

/** What a buyer checks before paying: the stream pays this lot, can't be cancelled or moved, in this token. */
export async function titleSearch(
  id: bigint,
  lot: Address,
  token: Address,
): Promise<TitleSearch> {
  const [recipient, cancelable, transferable, underlying] = await Promise.all([
    baseClient.readContract({
      ...lockup,
      functionName: "getRecipient",
      args: [id],
    }),
    baseClient.readContract({
      ...lockup,
      functionName: "isCancelable",
      args: [id],
    }),
    baseClient.readContract({
      ...lockup,
      functionName: "isTransferable",
      args: [id],
    }),
    baseClient.readContract({
      ...lockup,
      functionName: "getUnderlyingToken",
      args: [id],
    }),
  ]);
  const recipientIsLot = recipient.toLowerCase() === lot.toLowerCase();
  const tokenMatches = underlying.toLowerCase() === token.toLowerCase();
  return {
    recipientIsLot,
    cancelable,
    transferable,
    tokenMatches,
    clean: recipientIsLot && !cancelable && !transferable && tokenMatches,
  };
}

/** Already pulled out of the stream into the lot, in token units. */
export function withdrawn(id: bigint) {
  return baseClient.readContract({
    ...lockup,
    functionName: "getWithdrawnAmount",
    args: [id],
  });
}

/** Remaining in the stream (not yet withdrawn), in token units. */
export async function remaining(id: bigint) {
  const [deposited, pulled] = await Promise.all([
    baseClient.readContract({
      ...lockup,
      functionName: "getDepositedAmount",
      args: [id],
    }),
    withdrawn(id),
  ]);
  return deposited - pulled;
}
