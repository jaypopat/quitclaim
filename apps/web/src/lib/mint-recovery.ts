import { fetchStreamCreation } from "@quitclaim/shared/sablier.ts";
import type { Wizard } from "@/components/mint/wizard.ts";
import { mintRecord, readRecovery, useRecovery } from "./recovery.ts";

export function saveWizard(account: string, wizard: Wizard) {
  const value =
    wizard.step === "mint"
      ? {
          step: wizard.step,
          receiving: wizard.receiving,
          tx: `0x${wizard.stream.log.transaction_hash}`,
        }
      : wizard;
  const { mints } = readRecovery();
  useRecovery.setState({
    mints: { ...mints, [account]: mintRecord.parse(value) },
  });
}

export async function restoreWizard(account: string): Promise<Wizard> {
  const value = readRecovery().mints[account];
  if (!value) return { step: "address" };
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
