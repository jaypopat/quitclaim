/**
 * Sablier Lockup v4 on Base Sepolia, using the ABI and deployment address Sablier publishes in its
 * `sablier` package. A lot's value comes from a stream whose recipient is the lot address.
 * Quitclaim never signs calls to Sablier: anyone pulls the stream into the lot, and the lot only
 * signs ERC-20 transfers of the token fixed at mint.
 */
import {
  erc20Abi,
  parseEventLogs,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { sablier } from "sablier";
import { release } from "sablier/evm/releases/lockup/v4.0";
import { config, type CreationLog } from "@quitclaim/shared";
import { funderAccount, pub, wallet } from "./base.ts";

const lockupAbi = release.abi.SablierLockup;
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

const lockup = { address: LOCKUP, abi: lockupAbi } as const;
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

/**
 * A non-transferable linear stream paying `recipient`, funded by the funder. Non-cancelable unless
 * `cancelable` is set, which exists only to show the contract refusing such a stream.
 */
export async function createStream(
  recipient: Address,
  token: Address,
  amount: bigint,
  durationSec: number,
  { cancelable = false } = {},
) {
  const approve = await wallet().writeContract({
    address: token,
    abi: erc20Abi,
    functionName: "approve",
    args: [LOCKUP, amount],
  });
  await pub.waitForTransactionReceipt({ hash: approve });
  const tx = await wallet().writeContract({
    ...lockup,
    functionName: "createWithDurationsLL",
    args: [
      {
        sender: funderAccount().address,
        recipient,
        depositAmount: amount,
        token,
        cancelable,
        transferable: false,
        shape: "linear",
      },
      { start: 0n, cliff: 0n },
      0,
      { cliff: 0, total: durationSec },
    ],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success")
    throw new Error(`stream creation reverted: ${tx}`);
  const [created] = parseEventLogs({
    abi: lockupAbi,
    logs: receipt.logs,
    eventName: "CreateLockupLinearStream",
  }).filter((l) => l.address.toLowerCase() === LOCKUP.toLowerCase());
  if (!created) throw new Error(`no CreateLockupLinearStream log in ${tx}`);
  return {
    id: created.args.streamId,
    tx,
    block: receipt.blockNumber,
    log: toCreationLog(created),
  };
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
    pub.readContract({ ...lockup, functionName: "getRecipient", args: [id] }),
    pub.readContract({ ...lockup, functionName: "isCancelable", args: [id] }),
    pub.readContract({ ...lockup, functionName: "isTransferable", args: [id] }),
    pub.readContract({
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

/** Remaining in the stream (not yet withdrawn), in token units. */
export async function remaining(id: bigint) {
  const [deposited, withdrawn] = await Promise.all([
    pub.readContract({
      ...lockup,
      functionName: "getDepositedAmount",
      args: [id],
    }),
    pub.readContract({
      ...lockup,
      functionName: "getWithdrawnAmount",
      args: [id],
    }),
  ]);
  return deposited - withdrawn;
}

/** Permissionless: moves whatever has vested into the lot. Returns null when nothing is withdrawable. */
export async function pull(id: bigint, lot: Address): Promise<Hex | null> {
  if (
    (await pub.readContract({
      ...lockup,
      functionName: "withdrawableAmountOf",
      args: [id],
    })) === 0n
  )
    return null;
  const fee = await pub.readContract({
    ...lockup,
    functionName: "calculateMinFeeWei",
    args: [id],
  });
  const tx = await wallet().writeContract({
    ...lockup,
    functionName: "withdrawMax",
    args: [id, lot],
    value: fee,
  });
  await pub.waitForTransactionReceipt({ hash: tx });
  return tx;
}
