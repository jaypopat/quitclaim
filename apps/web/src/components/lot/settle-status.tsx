import { OUTSTANDING, type Settle } from "@quitclaim/shared/settle-progress.ts";
import { ProgressBar } from "@/components/dithercn/progress-bar";

const STEP: Record<Settle["phase"], string> = {
  idle: "Nothing signed yet.",
  signing: "MPC is signing.",
  signed: "Signed. Waiting for the keeper to broadcast it.",
  broadcast: "Broadcast. Waiting for Base to include it.",
  mined: "On Base. Waiting for MPC to prove it landed.",
  clean: "Clean: every signature is proven used.",
};

const STEPS = OUTSTANDING.length + 1;

/** Where the lot's oldest outstanding signature is. The keeper moves it along; this only watches. */
export function SettleStatus({ settle }: { settle: Settle }) {
  if (settle.phase === "idle" || settle.phase === "clean")
    return (
      <p className="text-sm text-muted-foreground">{STEP[settle.phase]}</p>
    );
  const step = OUTSTANDING.indexOf(settle.phase) + 1;
  return (
    <div className="flex flex-col gap-2">
      <ProgressBar
        label={`Nonce ${settle.nonce} · ${settle.sealing ? "sealing" : "transfer"}`}
        value={step}
        max={STEPS}
        valueText={`${step} of ${STEPS}`}
        segments={STEPS}
        size="sm"
      />
      <p className="text-sm">{STEP[settle.phase]}</p>
    </div>
  );
}
