import type { Lease, Lot } from "./lot.gen.ts";

/** By the caller's clock; the contract decides by NEAR block time. */
export const leaseRunOut = (lot: Lot, nowMs: number) =>
  !!lot.lease && nowMs >= lot.lease.ends_at_ms;

/** A lease that ran out while the lot sat Clean is over: the next call closes it (`live_lease`). */
export function liveLease(lot: Lot, nowMs: number): Lease | undefined {
  if (!lot.lease) return undefined;
  return lot.state === "Clean" && leaseRunOut(lot, nowMs)
    ? undefined
    : lot.lease;
}

/** Who may sign, seal, unseal and list: the lease holder while a lease is live, else the owner. */
export const controller = (lot: Lot, nowMs: number) =>
  liveLease(lot, nowMs)?.holder ?? lot.owner;
