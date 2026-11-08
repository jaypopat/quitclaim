import type { ReactNode } from "react";
import { fillStyle } from "@/lib/dither";

/** A stream's remaining schedule, left to right, with the buyer's share dithered in. */
function ScheduleBar({ share, label }: { share: number; label: ReactNode }) {
  return (
    <div className="mt-auto flex flex-col gap-2 pt-4">
      <div className="flex h-4 border">
        <div
          className="h-full"
          style={{
            width: `${share * 100}%`,
            ...fillStyle("hatched", { color: "ink" }),
          }}
        />
        <div
          className="h-full flex-1"
          style={fillStyle("dotted", { color: "grey" })}
        />
      </div>
      <div className="flex justify-between gap-3 font-mono text-xs text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function Kind({
  name,
  title,
  children,
  bar,
}: {
  name: string;
  title: string;
  children: ReactNode;
  bar: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border bg-card p-6">
      <span className="font-mono text-xs text-muted-foreground">{name}</span>
      <h3 className="text-xl leading-snug font-medium tracking-[-0.01em]">
        {title}
      </h3>
      <p className="text-sm text-pretty text-muted-foreground">{children}</p>
      {bar}
    </div>
  );
}

export function OfferKinds() {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-4">
      <Kind
        name="SELL"
        title="The buyer gets every payout left."
        bar={
          <ScheduleBar
            share={1}
            label={
              <>
                <span>now</span>
                <span>stream ends</span>
              </>
            }
          />
        }
      >
        The title moves for good. The seller gets NEAR, and the original holder
        can earn a royalty on each resale.
      </Kind>
      <Kind
        name="LEASE"
        title="The lessee gets the unlocks until it ends."
        bar={
          <ScheduleBar
            share={0.3}
            label={
              <>
                <span>lease</span>
                <span>back to the owner</span>
              </>
            }
          />
        }
      >
        They can withdraw only what vests during the lease. When it ends, the
        locks change again and control returns.
      </Kind>
    </div>
  );
}
