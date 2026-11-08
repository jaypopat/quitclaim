import { getAddress } from "viem";
import { z } from "zod";
import { LOT_CONTRACT } from "./contract.ts";

const operation = z.object({
  depositAddress: z.string().transform((value) => getAddress(value)),
  recipient: z.string(),
  amount: z.string().regex(/^\d+$/),
  payout: z.string(),
  deadline: z.string(),
  approvalStarted: z.boolean(),
  fromBlock: z.string().regex(/^\d+$/),
  txHash: z.string().optional(),
});
export type CashOutRecord = z.infer<typeof operation>;
const key = (id: number) => `quitclaim:cash-out:${LOT_CONTRACT}:${id}`;

// Save before opening a wallet, which may redirect away from this page.
export function readCashOut(id: number): CashOutRecord | null {
  const value = localStorage.getItem(key(id));
  return value === null ? null : operation.parse(JSON.parse(value));
}

export function saveCashOut(id: number, record: CashOutRecord | null) {
  if (record) localStorage.setItem(key(id), JSON.stringify(record));
  else localStorage.removeItem(key(id));
  window.dispatchEvent(new Event("cash-out"));
}

export function subscribeCashOut(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("cash-out", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("cash-out", callback);
  };
}

export const cashOutSnapshot = (id: number) => localStorage.getItem(key(id));
