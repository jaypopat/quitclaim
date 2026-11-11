import { nearToYocto, teraToGas } from "near-api-js";
import type { LotCalls } from "./lot.gen.ts";

/** The deposit MPC requests, and the one NEP-171-style calls require so a function-call key can't make them. */
export const YOCTO = 1n;

/** Covers the lot's storage at mint; the contract refunds the excess, and all of it on rollback. */
export const MINT_DEPOSIT = nearToYocto("0.05");

/** One transaction's limit. MPC calls forward 50 Tgas plus callbacks; unused gas is refunded. */
export const CALL_TGAS = 300;

/** One lot-contract call, exactly as a wallet or key signs it. */
export type ContractCall<M extends keyof LotCalls = keyof LotCalls> = {
  method: M;
  args: LotCalls[M]["args"];
  deposit: bigint;
  gas: bigint;
};

export const contractCall = <M extends keyof LotCalls>(
  method: M,
  args: LotCalls[M]["args"],
  deposit = 0n,
): ContractCall<M> => ({ method, args, deposit, gas: teraToGas(CALL_TGAS) });

/** Calls signed together in one transaction: they run in order and roll back together. */
export type Tx = ContractCall[];

/** A free state change ahead of `call` in the same transaction, sized so the pair fits one transaction's gas. */
export const after = (first: ContractCall, call: ContractCall): Tx => [
  { ...first, gas: teraToGas(PREP_TGAS) },
  { ...call, gas: teraToGas(CALL_TGAS - PREP_TGAS) },
];

const PREP_TGAS = 20;
