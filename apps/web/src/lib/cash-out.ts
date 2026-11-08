import { getAddress } from "viem";
import { z } from "zod";
import { persistedRecord } from "./persisted-record.ts";
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
const stores = new Map<
  number,
  ReturnType<typeof persistedRecord<CashOutRecord>>
>();
function cashOutStore(id: number) {
  let store = stores.get(id);
  if (!store) {
    store = persistedRecord(
      `quitclaim:cash-out:${LOT_CONTRACT}:${id}`,
      operation,
    );
    stores.set(id, store);
  }
  return store;
}

export const readCashOut = (id: number) => cashOutStore(id).read();
export const saveCashOut = (id: number, record: CashOutRecord | null) =>
  cashOutStore(id).write(record);
export const useCashOutRecord = (id: number) => cashOutStore(id).useValue();
