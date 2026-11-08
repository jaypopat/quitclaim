import {
  assertRecovery,
  readRecovery,
  useRecovery,
  type CashOutRecord,
} from "./recovery.ts";
export type { CashOutRecord } from "./recovery.ts";

export const readCashOut = (id: number) => readRecovery().cashOuts[id] ?? null;

export function saveCashOut(id: number, record: CashOutRecord | null) {
  const { cashOuts } = readRecovery();
  useRecovery.setState({ cashOuts: { ...cashOuts, [id]: record } });
}

export function useCashOutRecord(id: number) {
  // Invalid persisted data must block the UI as well as transaction builders.
  assertRecovery();
  return useRecovery((state) => state.cashOuts[id] ?? null);
}
