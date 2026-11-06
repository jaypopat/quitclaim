import {
  erc20Abi,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  parseTransaction,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { config, type Finality } from "@quitclaim/shared";
import { env } from "./env.ts";

const oracleAbi = [
  {
    type: "function",
    name: "getL1Fee",
    stateMutability: "view",
    inputs: [{ type: "bytes" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const pub = createPublicClient({
  chain: baseSepolia,
  transport: http(config.evm.rpcUrl),
});
export const funderAccount = () => privateKeyToAccount(env.funderKey());
export const wallet = () =>
  createWalletClient({
    chain: baseSepolia,
    transport: http(config.evm.rpcUrl),
    account: funderAccount(),
  });

export const txUrl = (hash: string) => `${config.evm.explorer}/tx/${hash}`;

/** Floor fees for a new tx: 2x the current base fee plus a 1 Mwei minimum tip. */
export async function floorFees() {
  const block = await pub.getBlock();
  const tip = await pub.estimateMaxPriorityFeePerGas();
  const maxPrio = tip > 1_000_000n ? tip : 1_000_000n;
  return { maxFee: 2n * (block.baseFeePerGas ?? 0n) + maxPrio, maxPrio };
}

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
    ((await pub.estimateGas({ account: lot, to: token, data })) * 13n) / 10n
  );
}

/** Worst-case cost of a signed tx: gas * maxFee + value + Base's L1 data fee. */
export async function maxCost(raw: Hex) {
  const tx = parseTransaction(raw);
  const l1 = await pub.readContract({
    address: baseSepolia.contracts.gasPriceOracle.address,
    abi: oracleAbi,
    functionName: "getL1Fee",
    args: [raw],
  });
  return (tx.gas ?? 0n) * (tx.maxFeePerGas ?? 0n) + (tx.value ?? 0n) + l1;
}

/** Tops the lot up to `need` from the funder and waits for the top-up to mine. */
export async function ensureBalance(address: Address, need: bigint) {
  const have = await pub.getBalance({ address });
  if (have >= need) return null;
  const hash = await wallet().sendTransaction({
    to: address,
    value: need - have + need / 2n,
  });
  await pub.waitForTransactionReceipt({ hash });
  return hash;
}

export async function fund(address: Address, value: bigint) {
  const hash = await wallet().sendTransaction({ to: address, value });
  await pub.waitForTransactionReceipt({ hash });
  return hash;
}

export type Broadcast =
  | { status: "sent" | "known"; hash: Hex }
  | { status: "nonce-too-low" | "error"; message: string };

export async function broadcast(raw: Hex): Promise<Broadcast> {
  try {
    return {
      status: "sent",
      hash: await pub.sendRawTransaction({ serializedTransaction: raw }),
    };
  } catch (e) {
    const message = (e as { details?: string }).details ?? String(e);
    if (/already known/i.test(message))
      return { status: "known", hash: keccak256(raw) };
    if (/nonce too low/i.test(message))
      return { status: "nonce-too-low", message };
    return { status: "error", message };
  }
}

export async function receipt(hash: Hex): Promise<TransactionReceipt | null> {
  return pub.getTransactionReceipt({ hash }).catch(() => null);
}

/** Resolves once the chain head at `finality` has reached `block`, so a proof won't time out at MPC. */
export async function waitFinality(
  block: bigint,
  finality: Finality,
  pollMs = 15_000,
) {
  const tag =
    finality === "Latest"
      ? "latest"
      : finality === "Safe"
        ? "safe"
        : "finalized";
  for (;;) {
    const head = await pub.getBlock({ blockTag: tag });
    if (head.number !== null && head.number >= block) return head.number;
    await Bun.sleep(pollMs);
  }
}

export function tokenBalance(token: Address, holder: Address) {
  return pub.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [holder],
  });
}
