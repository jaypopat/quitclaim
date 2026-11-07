import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  http,
  type Address,
} from "viem";
import { baseSepolia } from "viem/chains";
import { config } from "./config.ts";

/** Reads in the same tick share one Multicall3 call. */
export const baseClient = createPublicClient({
  chain: baseSepolia,
  transport: http(config.evm.rpcUrl),
  batch: { multicall: true },
});

export const baseTxUrl = (hash: string) => `${config.evm.explorer}/tx/${hash}`;
export const baseAddressUrl = (address: string) =>
  `${config.evm.explorer}/address/${address}`;

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

export function tokenBalance(token: Address, holder: Address) {
  return baseClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [holder],
  });
}
