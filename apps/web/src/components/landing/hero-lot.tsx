import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { offer, position } from "@quitclaim/shared/derive.ts";
import { formatUnits } from "viem";
import type { ReactNode } from "react";
import { DitherNumber } from "@/components/dithercn/dither-number";
import { ProgressBar } from "@/components/dithercn/progress-bar";
import { LotField } from "@/components/lot-field.tsx";
import { Skeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/use-now.ts";
import { formatPercent, formatToken, shortAddress } from "@/lib/format";
import { lotQuery } from "@/lib/queries.ts";

function Row({ chain, children }: { chain?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[3rem_1fr] items-center gap-4">
      <span className="font-mono text-xs text-muted-foreground">{chain}</span>
      {children}
    </div>
  );
}

function Wire({ label }: { label: string }) {
  return (
    <Row>
      <span className="ml-2 border-l border-dashed border-primary py-2 pl-4 font-mono text-xs text-muted-foreground">
        {label}
      </span>
    </Row>
  );
}

/** A real lot from the deployed contract, its vested amount ticking from the Sablier schedule. */
export function HeroLot({ id }: { id: number }) {
  const { data: view } = useQuery(lotQuery(id));
  const now = useNow();
  if (!view) return <Skeleton className="h-[420px]" />;
  const pos = position(view, now / 1000);
  const { decimals, symbol } = view.token;
  const vestedSoFar = pos.deposit - pos.locked;
  return (
    <Link
      to="/lot/$id"
      params={{ id }}
      className="flex flex-col gap-1 border bg-card p-6 transition-colors hover:border-muted-foreground"
    >
      <Row chain="NEAR">
        <div className="flex items-center gap-4 border border-primary p-4">
          <LotField
            id={id}
            offer={offer(view.lot, now).kind}
            size={2}
            className="size-12 shrink-0"
          />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-mono text-xs text-primary">
              NFT TITLE · NEP-171
            </span>
            <span className="font-medium">Quitclaim #{id}</span>
            <span className="truncate font-mono text-xs text-muted-foreground">
              held by {view.lot.owner}
            </span>
          </span>
        </div>
      </Row>
      <Wire label="controls signing for" />
      <Row chain="BASE">
        <div className="flex flex-col gap-2 border p-4">
          <span className="flex justify-between font-mono text-xs">
            <span className="text-primary">LOT ADDRESS · NO PRIVATE KEY</span>
            <span>{shortAddress(view.address)}</span>
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            VESTED SO FAR · {symbol}
          </span>
          <DitherNumber
            value={Number(formatUnits(vestedSoFar, decimals))}
            format={{
              minimumFractionDigits: decimals,
              maximumFractionDigits: decimals,
            }}
            size="md"
          />
          <span className="flex justify-between text-sm">
            <span>{formatPercent(pos.vestedFraction)} vested</span>
            <span className="text-muted-foreground">
              {formatToken(pos.locked, decimals)} {symbol} to come
            </span>
          </span>
          <ProgressBar
            label="Vested"
            hideLabel
            value={pos.vestedFraction}
            max={1}
            size="sm"
          />
        </div>
      </Row>
      <Wire label="pays out every second" />
      <Row>
        <div className="flex flex-col gap-1 border p-4">
          <span className="font-mono text-xs text-muted-foreground">
            SABLIER STREAM #{view.lot.source.id}
          </span>
          <span className="text-sm">
            Funded by the employer. Non-cancelable. Non-transferable.
          </span>
        </div>
      </Row>
      <p className="mt-3 text-xs text-muted-foreground">
        Sell the NFT and the address changes hands. The stream never notices.
      </p>
    </Link>
  );
}
