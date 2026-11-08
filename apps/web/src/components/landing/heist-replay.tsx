import { useMutation } from "@tanstack/react-query";
import { parseEvidence } from "@quitclaim/shared/heist/evidence.ts";
import { observe, replay } from "@quitclaim/shared/heist/observe.ts";
import { verifyHeist } from "@quitclaim/shared/heist/verify.ts";
import { useState } from "react";
import { Loader } from "@/components/dithercn/loader";
import { Button } from "@/components/ui/button";
import published from "../../../../../reports/heist.json";

/**
 * The keyless `bun run heist`, in the browser: verify the published handover from public RPCs, then
 * broadcast the seller's retained withdrawal to Base and show Base's own rejection.
 */
export function HeistReplay() {
  const [lines, setLines] = useState<string[]>([]);
  const run = useMutation({
    mutationFn: () => {
      setLines([]);
      return verifyHeist(parseEvidence(published), {
        observe,
        replay,
        log: (line) => setLines((all) => [...all, line]),
      });
    },
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex max-w-xl flex-col gap-2">
          <h3 className="text-2xl font-medium">
            This happened on testnet. Send Alice's real transaction yourself.
          </h3>
          <p className="text-sm text-muted-foreground">
            We published the withdrawal she kept. The button checks the sale
            from public NEAR and Base RPCs, then broadcasts her transaction to
            Base Sepolia, and Base rejects it.
          </p>
        </div>
        <Button size="lg" disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? "Replaying…" : "Try live replay"}
        </Button>
      </div>
      {(lines.length > 0 || run.isPending || run.isError) && (
        <pre className="overflow-x-auto border bg-background p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {lines.map((line) => (
            <div
              key={line}
              className={
                line.startsWith("PASS")
                  ? "text-foreground"
                  : line.startsWith("Base rejected")
                    ? "text-primary"
                    : "text-muted-foreground"
              }
            >
              {line}
            </div>
          ))}
          {run.isPending && <Loader />}
          {run.isError && (
            <div className="text-destructive">FAIL {run.error.message}</div>
          )}
        </pre>
      )}
    </div>
  );
}
