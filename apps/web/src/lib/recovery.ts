import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { getAddress } from "viem";
import { z } from "zod";
import { LOT_CONTRACT } from "./contract.ts";
import { lotName, txHash } from "./inputs.ts";

export const cashOutRecord = z.object({
  depositAddress: z.string().transform((value) => getAddress(value)),
  recipient: z.string(),
  amount: z.string().regex(/^\d+$/),
  payout: z.string(),
  deadline: z.string(),
  approvalStarted: z.boolean(),
  fromBlock: z.string().regex(/^\d+$/),
  txHash: z.string().optional(),
});
export type CashOutRecord = z.infer<typeof cashOutRecord>;

const receiving = z.object({
  name: lotName,
  royaltyBps: z.number().int().min(0).max(1000),
  path: z.string(),
  address: z.string().transform((value) => getAddress(value)),
});
export const mintRecord = z.discriminatedUnion("step", [
  z.object({ step: z.literal("address") }),
  z.object({ step: z.literal("stream"), receiving }),
  z.object({ step: z.literal("mint"), receiving, tx: txHash }),
  z.object({
    step: z.literal("done"),
    receiving,
    lotId: z.number().int().nonnegative(),
  }),
]);

const recovery = z.object({
  cashOuts: z.record(z.string(), cashOutRecord.nullable()),
  mints: z.record(z.string(), mintRecord),
});
type Recovery = z.infer<typeof recovery>;
const name = `quitclaim:recovery:${LOT_CONTRACT}`;
let hydrationError: unknown;

// Read old per-record keys once when moving to the single store. Keep them intact for recovery.
function initialRecords(): Recovery {
  const state: Recovery = { cashOuts: {}, mints: {} };
  if (
    typeof localStorage === "undefined" ||
    localStorage.getItem(name) !== null
  )
    return state;
  const oldEnvelope = z.object({
    state: z.object({ value: z.unknown() }),
    version: z.literal(1),
  });
  for (const key of Object.keys(localStorage)) {
    const cashPrefix = `quitclaim:cash-out:${LOT_CONTRACT}:`;
    const mintPrefix = `quitclaim:mint:${LOT_CONTRACT}:`;
    if (!key.startsWith(cashPrefix) && !key.startsWith(mintPrefix)) continue;
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    const parsed: unknown = JSON.parse(raw);
    const envelope = oldEnvelope.safeParse(parsed);
    const value = envelope.success ? envelope.data.state.value : parsed;
    if (key.startsWith(cashPrefix))
      state.cashOuts[key.slice(cashPrefix.length)] = cashOutRecord
        .nullable()
        .parse(value);
    else if (value !== null)
      state.mints[key.slice(mintPrefix.length)] = mintRecord.parse(value);
  }
  return state;
}

export const useRecovery = create<Recovery>()(
  persist(initialRecords, {
    name,
    version: 1,
    storage: createJSONStorage(() => localStorage),
    merge: (stored, current) =>
      stored === undefined ? current : recovery.parse(stored),
    migrate: () => {
      throw new Error("Unknown recovery record version");
    },
    onRehydrateStorage: () => (_state, error) => {
      hydrationError = error;
    },
  }),
);

/** Re-read before wallet actions, so stale UI cannot overwrite a pending payment. */
export function assertRecovery() {
  if (hydrationError)
    throw new Error("Cannot recover saved operation", {
      cause: hydrationError,
    });
}

export function readRecovery() {
  void useRecovery.persist.rehydrate();
  assertRecovery();
  return useRecovery.getState();
}
