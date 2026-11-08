import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { offer, position } from "@quitclaim/shared/derive.ts";
import type { HeldToken } from "@quitclaim/shared/lot-views.ts";
import type { LotView } from "@quitclaim/shared/lot-view.ts";
import { ProgressBar } from "@/components/dithercn/progress-bar";
import { LotField } from "@/components/lot-field.tsx";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/use-now.ts";
import { dayMonth, formatToken, shortAddress } from "@/lib/format";
import { leaseLeftQuery, lotQuery } from "@/lib/queries.ts";

/** What a lessee may still move out before the lease ends. */
function LeaseLeft({ view }: { view: LotView }) {
  const { data: left } = useQuery(leaseLeftQuery(view.id));
  const endsAtMs = view.lot.lease?.ends_at_ms;
  return (
    <span className="text-sm text-muted-foreground">
      Lease until {endsAtMs && dayMonth(endsAtMs)}
      {left !== undefined &&
        ` · ${formatToken(left, view.token.decimals)} ${view.token.symbol} left to withdraw`}
    </span>
  );
}

/** One title or lease the account holds; the lot page has its actions. */
export function HoldingRow({ token }: { token: HeldToken }) {
  const { data: view } = useQuery(lotQuery(token.lotId));
  const now = useNow(5_000);
  if (!view) return <Skeleton className="h-24" />;
  const pos = position(view, now / 1000);
  const fmt = (v: bigint) => formatToken(v, view.token.decimals);
  return (
    <Link
      to="/lot/$id"
      params={{ id: view.id }}
      className="grid items-center gap-x-7 gap-y-3 border-b py-5 transition-colors hover:bg-card md:grid-cols-[minmax(200px,1fr)_minmax(160px,2fr)_auto]"
    >
      <span className="flex items-center gap-4">
        <LotField
          id={view.id}
          offer={offer(view.lot, now).kind}
          size={2}
          className="size-14 shrink-0 border"
        />
        <span className="flex flex-col gap-1">
          <span className="font-medium">
            Quitclaim #{view.id}
            {token.item === "Lease" && " · lease"}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {shortAddress(view.address)}
          </span>
        </span>
      </span>
      <span className="flex flex-col gap-2">
        <ProgressBar
          label={`${Math.round(pos.vestedFraction * 100)}% vested`}
          hideLabel
          value={pos.vestedFraction}
          max={1}
          size="sm"
        />
        {token.item === "Lease" ? (
          <LeaseLeft view={view} />
        ) : (
          <span className="text-sm text-muted-foreground">
            {fmt(pos.held)} in address · {fmt(pos.locked)} locked
          </span>
        )}
      </span>
      <Badge variant="outline">{view.lot.state}</Badge>
    </Link>
  );
}
