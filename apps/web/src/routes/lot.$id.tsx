import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import {
  history,
  nonceSlots,
  offer,
  position,
  titleChecks,
} from "@quitclaim/shared/derive.ts";
import { baseAddressUrl } from "@quitclaim/shared/base.ts";
import { settleProgress } from "@quitclaim/shared/settle-progress.ts";
import { HistoryList } from "@/components/lot/history-list.tsx";
import { LotActions } from "@/components/lot/lot-actions.tsx";
import { NonceStrip } from "@/components/lot/nonce-strip.tsx";
import { OfferBox } from "@/components/lot/offer-box.tsx";
import { PositionStats } from "@/components/lot/position-stats.tsx";
import { PullButton } from "@/components/lot/pull-button.tsx";
import { SettleStatus } from "@/components/lot/settle-status.tsx";
import { TitleChecks } from "@/components/lot/title-checks.tsx";
import { VestingChart } from "@/components/lot/vesting-chart.tsx";
import { LotField } from "@/components/lot-field.tsx";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/use-now.ts";
import { formatToken } from "@/lib/format";
import { frozenQuery, liveLotQuery } from "@/lib/queries.ts";

const lotParams = z.object({ id: z.coerce.number().int().nonnegative() });

export const Route = createFileRoute("/lot/$id")({
  params: {
    parse: (raw) => lotParams.parse(raw),
    stringify: ({ id }) => ({ id: String(id) }),
  },
  component: LotPage,
});

function LotPage() {
  const { id } = Route.useParams();
  const { data: view, error } = useQuery(liveLotQuery(id));
  const { data: frozen = false } = useQuery(frozenQuery);
  const now = useNow();

  if (error)
    return (
      <main className="px-[clamp(20px,4vw,64px)] py-10 text-destructive">
        {error.message}
      </main>
    );
  if (!view)
    return (
      <main className="grid gap-10 px-[clamp(20px,4vw,64px)] py-10 lg:grid-cols-[2fr_1fr]">
        <Skeleton className="h-[560px]" />
        <Skeleton className="h-60" />
      </main>
    );

  const current = offer(view.lot, now);
  const pos = position(view, now / 1000);
  const schedule = view.lot.source.schedule;
  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-[clamp(20px,4vw,64px)] py-5 lg:min-h-[calc(100dvh-4rem-1px)] lg:justify-center">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <Link
          to="/market"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Market
        </Link>
        <span className="font-mono text-xs text-muted-foreground">
          Read live from NEAR testnet, Base Sepolia and Sablier
        </span>
      </div>
      <div className="grid gap-x-10 gap-y-6 [grid-template-areas:'head'_'offer'_'body'_'checks'] lg:grid-cols-[minmax(0,1fr)_minmax(280px,24rem)] lg:grid-rows-[auto_1fr] lg:[grid-template-areas:'head_side'_'body_side']">
        <div className="flex min-w-0 items-center gap-5 [grid-area:head]">
          <LotField
            id={id}
            offer={current.kind}
            size={2}
            className="size-[clamp(64px,7vw,96px)] shrink-0 border"
          />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate font-mono text-xs text-muted-foreground">
              NFT · NEP-171 · {view.lot.path}
            </span>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-[clamp(30px,3.6vw,44px)] leading-none font-medium tracking-[-0.03em]">
                Quitclaim #{id}
              </h1>
              <Badge variant="outline">{view.lot.state}</Badge>
            </div>
            <a
              href={baseAddressUrl(view.address)}
              target="_blank"
              rel="noreferrer"
              className="truncate font-mono text-xs text-muted-foreground hover:text-foreground"
            >
              Controls {view.address} on Base ↗
            </a>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-6 [grid-area:body]">
          <VestingChart
            schedule={schedule}
            nowSec={now / 1000}
            decimals={view.token.decimals}
            symbol={view.token.symbol}
          />
          <PositionStats
            position={pos}
            token={view.token}
            withdrawn={view.stream.withdrawn}
            endSec={schedule.end}
          />
          <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
            <NonceStrip slots={nonceSlots(view)} />
            <HistoryList entries={history(view.lot)} token={view.token} />
          </div>
        </div>
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-6 lg:[grid-area:side]">
          <div className="min-w-0 [grid-area:offer]">
            <OfferBox offer={current} lot={view.lot}>
              <SettleStatus settle={settleProgress(view)} />
              <LotActions view={view} />
              {pos.claimable >= 10n ** BigInt(view.token.decimals - 2) && (
                <PullButton
                  id={id}
                  label={`Pull ${formatToken(pos.claimable, view.token.decimals)} ${view.token.symbol} from the stream`}
                />
              )}
            </OfferBox>
          </div>
          <div className="min-w-0 [grid-area:checks]">
            <TitleChecks checks={titleChecks(view, frozen)} />
          </div>
        </div>
      </div>
    </main>
  );
}
