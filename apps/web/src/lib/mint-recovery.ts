import { getAddress } from "viem";
import { z } from "zod";
import { fetchStreamCreation } from "@quitclaim/shared/sablier.ts";
import type { Wizard } from "@/components/mint/wizard.ts";
import { LOT_CONTRACT } from "./contract.ts";
import { lotName, txHash } from "./inputs.ts";

const receiving = z.object({
  name: lotName,
  royaltyBps: z.number().int().min(0).max(1000),
  path: z.string(),
  address: z.string().transform((value) => getAddress(value)),
});
const saved = z.discriminatedUnion("step", [
  z.object({ step: z.literal("address") }),
  z.object({ step: z.literal("stream"), receiving }),
  z.object({ step: z.literal("mint"), receiving, tx: txHash }),
  z.object({
    step: z.literal("done"),
    receiving,
    lotId: z.number().int().nonnegative(),
  }),
]);
const key = (account: string) => `quitclaim:mint:${LOT_CONTRACT}:${account}`;

export function saveWizard(account: string, wizard: Wizard) {
  const value =
    wizard.step === "mint"
      ? {
          step: wizard.step,
          receiving: wizard.receiving,
          tx: `0x${wizard.stream.log.transaction_hash}`,
        }
      : wizard;
  localStorage.setItem(key(account), JSON.stringify(value));
}

export async function restoreWizard(account: string): Promise<Wizard> {
  const raw = localStorage.getItem(key(account));
  if (!raw) return { step: "address" };
  const value = saved.parse(JSON.parse(raw));
  if (
    value.step !== "address" &&
    value.receiving.path !== `${account}/${value.receiving.name}`
  )
    throw new Error("Stored receiving address belongs to another minter.");
  return value.step === "mint"
    ? {
        step: "mint",
        receiving: value.receiving,
        stream: await fetchStreamCreation(value.tx),
      }
    : value;
}
