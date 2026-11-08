import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { contractCall } from "@quitclaim/shared/calls.ts";
import { position } from "@quitclaim/shared/derive.ts";
import { formatUnits } from "viem";
import { DitherNumber } from "@/components/dithercn/dither-number";
import { EmptyState } from "@/components/dithercn/empty-state";
import { HoldingRow } from "@/components/portfolio/holding-row.tsx";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/use-now.ts";
import { formatNear } from "@/lib/format";
import { holdingsQuery, lotQuery, proceedsQuery } from "@/lib/queries.ts";
import { useSend } from "@/lib/use-send.ts";

/** Remaining payouts under the titles `account` owns, once every title has loaded. */
function TitlesValue({ ids }: { ids: number[] }) {
  const now = useNow(5_000);
  const views = useQueries({
    queries: ids.map(lotQuery),
    combine: (results) => results.flatMap((r) => (r.data ? [r.data] : [])),
  });
  const token = views[0]?.token;
  const total = views.reduce(
    (sum, v) => sum + position(v, now / 1000).remaining,
    0n,
  );
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-muted-foreground">
        Remaining payouts under your titles
      </span>
      {views.length < ids.length ? (
        <Skeleton className="h-10 w-40" />
      ) : (
        <span className="flex items-baseline gap-2">
          <DitherNumber
            value={token ? Number(formatUnits(total, token.decimals)) : 0}
            format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
            size="md"
          />
          <span className="text-sm text-muted-foreground">{token?.symbol}</span>
        </span>
      )}
    </div>
  );
}

function Proceeds({ account }: { account: string }) {
  const { data: proceeds } = useQuery(proceedsQuery(account));
  const send = useSend();
  return (
    <>
      <div className="flex flex-col gap-1 text-right">
        <span className="text-sm text-muted-foreground">Sale proceeds</span>
        <span className="text-2xl font-medium">
          {proceeds === undefined ? "…" : `${formatNear(proceeds)} NEAR`}
        </span>
      </div>
      {!!proceeds && (
        <Alert className="col-span-full">
          <AlertDescription>
            Your sale settled. {formatNear(proceeds)} NEAR is ready to withdraw.
          </AlertDescription>
          <AlertAction>
            <Button
              disabled={send.isPending}
              onClick={() =>
                send.mutate(() => contractCall("withdraw_proceeds", {}))
              }
            >
              Withdraw
            </Button>
          </AlertAction>
        </Alert>
      )}
    </>
  );
}

export function Holdings({ account }: { account: string }) {
  const { data: held, error } = useQuery(holdingsQuery(account));
  const titleIds = (held ?? [])
    .filter((t) => t.item === "Title")
    .map((t) => t.lotId);
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-[1fr_auto] items-end gap-6 border-b pb-6">
        <TitlesValue ids={titleIds} />
        <Proceeds account={account} />
      </div>
      <section className="flex flex-col">
        <header className="flex items-baseline justify-between border-b pb-3">
          <h2 className="text-lg font-medium">Your lots</h2>
          <span className="font-mono text-xs text-muted-foreground">
            {held?.length ?? "…"}
          </span>
        </header>
        {error && (
          <p className="py-4 text-sm text-destructive">{error.message}</p>
        )}
        {held?.map((token) => (
          <HoldingRow key={`${token.lotId}-${token.item}`} token={token} />
        ))}
        {held?.length === 0 && (
          <EmptyState
            title="You don't own a lot yet."
            description="Buy or lease one on the market, or mint a title from a stream that pays you."
            illustration="box"
            action={
              <Button asChild variant="outline">
                <Link to="/market">Browse the market</Link>
              </Button>
            }
          />
        )}
      </section>
    </div>
  );
}
