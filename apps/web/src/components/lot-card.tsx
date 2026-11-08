import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { offer, position } from "@quitclaim/shared/derive.ts";
import { Skeleton } from "@/components/ui/skeleton";
import { LotField } from "@/components/lot-field.tsx";
import { offerPrice } from "@/components/offer-price.tsx";
import { useNow } from "@/hooks/use-now.ts";
import { formatPercent, formatToken, monthYear } from "@/lib/format";
import { lotQuery } from "@/lib/queries.ts";

export function LotCard({ id }: { id: number }) {
  const { data: view, error } = useQuery(lotQuery(id));
  const now = useNow(5_000);
  if (error)
    return (
      <div className="border bg-card p-4 text-sm text-destructive">
        Quitclaim #{id}: {error.message}
      </div>
    );
  if (!view) return <Skeleton className="h-96" />;
  const pos = position(view, now / 1000);
  const current = offer(view.lot, now);
  const { price, note } = offerPrice(current);
  return (
    <Link
      to="/lot/$id"
      params={{ id }}
      className="group flex flex-col gap-3 border bg-card p-4 transition-colors hover:border-muted-foreground"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">Quitclaim #{id}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {view.lot.state}
        </span>
      </div>
      <div className="relative">
        <LotField id={id} offer={current.kind} className="aspect-[4/3]" />
        <div className="absolute inset-x-0 bottom-0 flex justify-between bg-gradient-to-t from-card px-1 pt-6 font-mono text-xs text-muted-foreground">
          <span>{formatPercent(pos.vestedFraction)} vested</span>
          <span>ends {monthYear(view.lot.source.schedule.end * 1000)}</span>
        </div>
      </div>
      <div className="flex items-end justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {formatToken(pos.remaining, view.token.decimals)} {view.token.symbol}{" "}
          remaining
        </span>
        <span className="text-right">
          <span className="block text-xl font-semibold tracking-tight">
            {price}
          </span>
          {note && (
            <span className="font-mono text-xs text-muted-foreground">
              {note}
            </span>
          )}
        </span>
      </div>
    </Link>
  );
}
