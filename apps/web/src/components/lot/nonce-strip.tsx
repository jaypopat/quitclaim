import type { NonceSlot, NonceStatus } from "@quitclaim/shared/derive.ts";
import type { CSSProperties } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fillStyle } from "@/lib/dither";

const LOOK: Record<NonceStatus, { label: string; style: CSSProperties }> = {
  used: {
    label: "used",
    style: fillStyle("solid", { color: "var(--foreground)" }),
  },
  burned: { label: "burned", style: fillStyle("hatched", { color: "ink" }) },
  "signed-unsent": {
    label: "signed, not sent",
    style: fillStyle("dotted", { color: "ink" }),
  },
  open: { label: "open", style: {} },
};

const LEGEND: NonceStatus[] = ["used", "burned", "signed-unsent"];

/** One cell per Base nonce of the lot address, so a buyer sees nothing signed is left to land. */
export function NonceStrip({ slots }: { slots: NonceSlot[] }) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-baseline justify-between border-b pb-3">
        <h2 className="text-lg font-medium">Signatures</h2>
        <span className="font-mono text-xs text-muted-foreground">
          by Base nonce
        </span>
      </header>
      <ol className="grid grid-cols-8 gap-1">
        {slots.map(({ nonce, status }) => (
          <li key={nonce} className="flex flex-col gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="h-7 border"
                  style={LOOK[status].style}
                  aria-label={`nonce ${nonce}: ${LOOK[status].label}`}
                />
              </TooltipTrigger>
              <TooltipContent>
                Nonce {nonce}: {LOOK[status].label}
              </TooltipContent>
            </Tooltip>
            <span className="font-mono text-[10px] text-muted-foreground">
              {nonce}
            </span>
          </li>
        ))}
      </ol>
      <div className="flex gap-4 font-mono text-xs text-muted-foreground">
        {LEGEND.map((status) => (
          <span key={status} className="flex items-center gap-1.5">
            <span className="size-2.5 border" style={LOOK[status].style} />
            {LOOK[status].label}
          </span>
        ))}
      </div>
    </section>
  );
}
