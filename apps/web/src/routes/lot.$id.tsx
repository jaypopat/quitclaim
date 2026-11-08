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
import { HistoryList } from "@/components/lot/history-list.tsx";
import { NonceStrip } from "@/components/lot/nonce-strip.tsx";
import { OfferBox } from "@/components/lot/offer-box.tsx";
import { PositionStats } from "@/components/lot/position-stats.tsx";
import { TitleChecks } from "@/components/lot/title-checks.tsx";
import { VestingChart } from "@/components/lot/vesting-chart.tsx";
import { LotField } from "@/components/lot-field.tsx";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/use-now.ts";
import { frozenQuery, lotQuery } from "@/lib/queries.ts";

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
  const { data: view, error } = useQuery(lotQuery(id));
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
  const schedule = view.lot.source.schedule;
  return (
    <main className="flex flex-col gap-10 px-[clamp(20px,4vw,64px)] py-8">
      <Link
        to="/market"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Market
      </Link>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
        <div className="flex min-w-0 flex-col gap-8">
          <div className="flex items-center gap-5">
            <LotField
              id={id}
              offer={current.kind}
              size={2}
              className="size-24 shrink-0 border"
            />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-mono text-xs text-muted-foreground">
                NFT · NEP-171 · {view.lot.path}
              </span>
              <div className="flex items-baseline gap-3">
                <h1 className="text-5xl font-medium tracking-tight">
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
          <VestingChart
            schedule={schedule}
            nowSec={now / 1000}
            decimals={view.token.decimals}
            symbol={view.token.symbol}
          />
          <PositionStats
            position={position(view, now / 1000)}
            token={view.token}
            withdrawn={view.stream.withdrawn}
            endSec={schedule.end}
          />
        </div>
        <div>
          <OfferBox offer={current} lot={view.lot} />
        </div>
      </div>
      <p className="border p-4 text-sm text-muted-foreground">
        Every figure here is read live from NEAR testnet, Base Sepolia and
        Sablier. Ownership protection depends on honest MPC signing and
        attestation, a frozen contract, and Base finality.
      </p>
      <div className="grid gap-10 lg:grid-cols-2">
        <TitleChecks checks={titleChecks(view, frozen)} />
        <div className="flex flex-col gap-10">
          <NonceStrip slots={nonceSlots(view)} />
          <HistoryList entries={history(view.lot)} token={view.token} />
        </div>
      </div>
    </main>
  );
}
