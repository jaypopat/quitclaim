/**
 * Sablier Lockup v4 on Base Sepolia. A lot's value comes from a stream whose recipient is the lot
 * address. Quitclaim never signs calls to Sablier: anyone pulls the stream into the lot, and the lot
 * only signs ERC-20 transfers of the token fixed at mint.
 */
import type { Address, Hex } from "viem";
import { funderAccount, pub, wallet } from "./base.ts";

export const LOCKUP: Address = "0xA65A1ecEf02C2B9BDc604951c6A6D02335D4532e";
export const SOURCE_KIND = "sablier-lockup-v4";

const lockupAbi = [
  {
    type: "function",
    name: "createWithDurationsLL",
    stateMutability: "payable",
    inputs: [
      {
        type: "tuple",
        components: [
          { name: "sender", type: "address" },
          { name: "recipient", type: "address" },
          { name: "depositAmount", type: "uint128" },
          { name: "token", type: "address" },
          { name: "cancelable", type: "bool" },
          { name: "transferable", type: "bool" },
          { name: "shape", type: "string" },
        ],
      },
      { type: "tuple", components: [{ name: "start", type: "uint128" }, { name: "cliff", type: "uint128" }] },
      { name: "granularity", type: "uint40" },
      { type: "tuple", components: [{ name: "cliff", type: "uint40" }, { name: "total", type: "uint40" }] },
    ],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "nextStreamId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "withdrawMax", stateMutability: "payable", inputs: [{ type: "uint256" }, { type: "address" }], outputs: [{ type: "uint128" }] },
  { type: "function", name: "calculateMinFeeWei", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getRecipient", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "isCancelable", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "isTransferable", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "getUnderlyingToken", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "getDepositedAmount", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint128" }] },
  { type: "function", name: "getWithdrawnAmount", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint128" }] },
  { type: "function", name: "withdrawableAmountOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint128" }] },
] as const;
const erc20Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

const view = { address: LOCKUP, abi: lockupAbi } as const;

/** A non-cancelable, non-transferable linear stream paying `recipient`, funded by the funder. */
export async function createStream(recipient: Address, token: Address, amount: bigint, durationSec: number) {
  const approve = await wallet().writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [LOCKUP, amount] });
  await pub.waitForTransactionReceipt({ hash: approve });
  const id = await pub.readContract({ ...view, functionName: "nextStreamId" });
  const tx = await wallet().writeContract({
    address: LOCKUP,
    abi: lockupAbi,
    functionName: "createWithDurationsLL",
    args: [
      { sender: funderAccount().address, recipient, depositAmount: amount, token, cancelable: false, transferable: false, shape: "linear" },
      { start: 0n, cliff: 0n },
      0,
      { cliff: 0, total: durationSec },
    ],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success") throw new Error(`stream creation reverted: ${tx}`);
  return { id, tx };
}

export type TitleSearch = {
  recipientIsLot: boolean;
  cancelable: boolean;
  transferable: boolean;
  tokenMatches: boolean;
  clean: boolean;
};

/** What a buyer checks before paying: the stream pays this lot, can't be cancelled or moved, in this token. */
export async function titleSearch(id: bigint, lot: Address, token: Address): Promise<TitleSearch> {
  const [recipient, cancelable, transferable, underlying] = await Promise.all([
    pub.readContract({ ...view, functionName: "getRecipient", args: [id] }),
    pub.readContract({ ...view, functionName: "isCancelable", args: [id] }),
    pub.readContract({ ...view, functionName: "isTransferable", args: [id] }),
    pub.readContract({ ...view, functionName: "getUnderlyingToken", args: [id] }),
  ]);
  const recipientIsLot = recipient.toLowerCase() === lot.toLowerCase();
  const tokenMatches = underlying.toLowerCase() === token.toLowerCase();
  return { recipientIsLot, cancelable, transferable, tokenMatches, clean: recipientIsLot && !cancelable && !transferable && tokenMatches };
}

/** Remaining in the stream (not yet withdrawn), in token units. */
export async function remaining(id: bigint) {
  const [deposited, withdrawn] = await Promise.all([
    pub.readContract({ ...view, functionName: "getDepositedAmount", args: [id] }),
    pub.readContract({ ...view, functionName: "getWithdrawnAmount", args: [id] }),
  ]);
  return deposited - withdrawn;
}

/** Permissionless: moves whatever has vested into the lot. Returns null when nothing is withdrawable. */
export async function pull(id: bigint, lot: Address): Promise<Hex | null> {
  if ((await pub.readContract({ ...view, functionName: "withdrawableAmountOf", args: [id] })) === 0n) return null;
  const fee = await pub.readContract({ ...view, functionName: "calculateMinFeeWei", args: [id] });
  const tx = await wallet().writeContract({ address: LOCKUP, abi: lockupAbi, functionName: "withdrawMax", args: [id, lot], value: fee });
  await pub.waitForTransactionReceipt({ hash: tx });
  return tx;
}
