import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  http,
  type Address,
} from "viem";
import { baseSepolia } from "viem/chains";
import { config } from "./config.ts";
import type { Finality } from "./lot.gen.ts";

/** Reads in the same tick share one Multicall3 call. */
export const baseClient = createPublicClient({
  chain: baseSepolia,
  transport: http(config.evm.rpcUrl),
  batch: { multicall: true },
});

export const baseTxUrl = (hash: string) => `${config.evm.explorer}/tx/${hash}`;
export const baseAddressUrl = (address: string) =>
  `${config.evm.explorer}/address/${address}`;

/** Whether Base's head at the lot contract's finality has reached `block`, as MPC needs before it attests a log. */
export async function reached(block: bigint, finality: Finality) {
  const blockTag = finality.toLowerCase() as Lowercase<Finality>;
  return (await baseClient.getBlock({ blockTag })).number >= block;
}

/** Floor fees for a new tx: 2x the current base fee plus a 1 Mwei minimum tip. */
export async function floorFees() {
  const block = await baseClient.getBlock();
  const tip = await baseClient.estimateMaxPriorityFeePerGas();
  const maxPrio = tip > 1_000_000n ? tip : 1_000_000n;
  return { maxFee: 2n * (block.baseFeePerGas ?? 0n) + maxPrio, maxPrio };
}

export type FloorFees = Awaited<ReturnType<typeof floorFees>>;

export async function estimateTransferGas(
  token: Address,
  lot: Address,
  to: Address,
  amount: bigint,
) {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, amount],
  });
  return (
    ((await baseClient.estimateGas({ account: lot, to: token, data })) * 13n) /
    10n
  );
}

export async function tokenInfo(token: Address) {
  const read = <F extends "symbol" | "decimals">(functionName: F) =>
    baseClient.readContract({ address: token, abi: erc20Abi, functionName });
  const [symbol, decimals] = await Promise.all([
    read("symbol"),
    read("decimals"),
  ]);
  return { address: token, symbol, decimals };
}

export function tokenBalance(token: Address, holder: Address) {
  return baseClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [holder],
  });
}
