import {
  createWalletClient,
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
import { baseClient } from "@quitclaim/shared/base.ts";
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

export const funderAccount = () => privateKeyToAccount(env.funderKey());
export const wallet = () =>
  createWalletClient({
    chain: baseSepolia,
    transport: http(config.evm.rpcUrl),
    account: funderAccount(),
  });

/** Worst-case cost of a signed tx: gas * maxFee + value + Base's L1 data fee. */
export async function maxCost(raw: Hex) {
  const tx = parseTransaction(raw);
  const l1 = await baseClient.readContract({
    address: baseSepolia.contracts.gasPriceOracle.address,
    abi: oracleAbi,
    functionName: "getL1Fee",
    args: [raw],
  });
  return (tx.gas ?? 0n) * (tx.maxFeePerGas ?? 0n) + (tx.value ?? 0n) + l1;
}

/** Tops the lot up to `need` from the funder and waits for the top-up to mine. */
export async function ensureBalance(address: Address, need: bigint) {
  const have = await baseClient.getBalance({ address });
  if (have >= need) return null;
  const hash = await wallet().sendTransaction({
    to: address,
    value: need - have + need / 2n,
  });
  await baseClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function fund(address: Address, value: bigint) {
  const hash = await wallet().sendTransaction({ to: address, value });
  await baseClient.waitForTransactionReceipt({ hash });
  return hash;
}

export type Broadcast =
  | { status: "sent" | "known"; hash: Hex }
  | { status: "nonce-too-low" | "error"; message: string };

export async function broadcast(raw: Hex): Promise<Broadcast> {
  try {
    return {
      status: "sent",
      hash: await baseClient.sendRawTransaction({ serializedTransaction: raw }),
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
  return baseClient.getTransactionReceipt({ hash }).catch(() => null);
}

/** Resolves once the chain head at `finality` has reached `block`, so a proof won't time out at MPC. */
export async function waitFinality(block: bigint, finality: Finality) {
  const blockTag = finality.toLowerCase() as Lowercase<Finality>;
  for (;;) {
    const head = await baseClient.getBlock({ blockTag });
    if (head.number >= block) return head.number;
    await Bun.sleep(15_000);
  }
}
