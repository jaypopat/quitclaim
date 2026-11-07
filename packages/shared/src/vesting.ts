import type { Schedule } from "./lot.gen.ts";

/**
 * Sablier Lockup v4 `LockupMath.calculateStreamedAmountLL` at Unix second `t`, as the contract's
 * `Schedule::vested` computes it, so a lease budget shown here matches what the contract allows.
 */
export function vested(schedule: Schedule, t: number): bigint {
  const deposit = BigInt(schedule.deposit);
  if (schedule.start > t) return 0n;
  if (schedule.cliff > t) return BigInt(schedule.start_unlock);
  if (schedule.end <= t) return deposit;
  const unlocks = BigInt(schedule.start_unlock) + BigInt(schedule.cliff_unlock);
  if (unlocks >= deposit) return deposit;
  const from = schedule.cliff === 0 ? schedule.start : schedule.cliff;
  const granularity = BigInt(schedule.granularity);
  const units = BigInt(t - from) / granularity;
  return (
    unlocks +
    (units * (deposit - unlocks) * granularity) / BigInt(schedule.end - from)
  );
}
