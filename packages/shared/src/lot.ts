import type { Fees, Issued } from "./lot.gen.ts";

export type * from "./lot.gen.ts";

export const isBurn = (i: Issued) => i.kind === "Burn";

/** Fees for a new tx at `nonce`: at least `floor`, and >=10% over everything already issued there. */
export function nextFees(issued: Issued[], nonce: number, floor: { maxFee: bigint; maxPrio: bigint }): Fees {
  const atNonce = issued.filter((i) => i.nonce === nonce);
  const bump = (v: bigint) => (v * 11n) / 10n + 1n;
  const max = (a: bigint, b: bigint) => (a > b ? a : b);
  const prevFee = atNonce.reduce((m, i) => max(m, BigInt(i.fees.max_fee)), 0n);
  const prevPrio = atNonce.reduce((m, i) => max(m, BigInt(i.fees.max_prio)), 0n);
  const maxPrio = atNonce.length ? max(bump(prevPrio), floor.maxPrio) : floor.maxPrio;
  const maxFee = max(atNonce.length ? max(bump(prevFee), floor.maxFee) : floor.maxFee, maxPrio);
  return { max_fee: maxFee.toString(), max_prio: maxPrio.toString() };
}
