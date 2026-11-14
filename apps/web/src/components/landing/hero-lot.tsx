import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { offer } from "@quitclaim/shared/derive.ts";
import { vested } from "@quitclaim/shared/vesting.ts";
import { formatUnits } from "viem";
import type { ReactNode } from "react";
import { DitherNumber } from "@/components/dithercn/dither-number";
import { ProgressBar } from "@/components/dithercn/progress-bar";
import { LotField } from "@/components/lot-field.tsx";
import { offerPrice } from "@/components/offer-price.tsx";
import { useNow } from "@/hooks/use-now.ts";
import { formatPercent, formatToken, shortAddress } from "@/lib/format";
import { heroLotQuery } from "@/lib/queries.ts";
import { Skeleton } from "@/components/ui/skeleton";
import { HERO_SNAPSHOT } from "./hero-snapshot.ts";

function Row({ chain, children }: { chain?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-3">
      <span className="font-mono text-xs text-muted-foreground">{chain}</span>
      {children}
    </div>
  );
}

/** A dashed line whose dashes travel: payouts flow down into the address, control flows up from the title. */
function Wire({ label, up = false }: { label: string; up?: boolean }) {
  return (
    <Row>
      <span className="relative ml-2 py-2 pl-4 font-mono text-xs text-muted-foreground">
        <span
          aria-hidden
          className={`absolute inset-y-0 left-0 w-px animate-[wire-flow_0.8s_linear_infinite] bg-[repeating-linear-gradient(to_bottom,var(--primary)_0_4px,transparent_4px_8px)] motion-reduce:animate-none ${up ? "[animation-direction:reverse]" : ""}`}
        />
        {up ? "↑" : "↓"} {label}
      </span>
    </Row>
  );
}

/** A real lot from the deployed contract: the stream pays an address, and the title decides who signs for it. */
export function HeroLot({ id }: { id: number }) {
  // A baked copy of the lot paints at once; the live read replaces it a moment later.
  const { data } = useQuery({
    ...heroLotQuery(id),
    placeholderData: id === HERO_SNAPSHOT.id ? HERO_SNAPSHOT : undefined,
  });
  const now = useNow();
  if (!data) return <Skeleton className="h-[420px]" />;
  const { lot, address, token } = data;
  const { decimals, symbol } = token;
  const deposit = BigInt(lot.source.schedule.deposit);
  const vestedNow = vested(lot.source.schedule, now / 1000);
  const vestedFraction = Number((vestedNow * 10_000n) / deposit) / 10_000;
  const current = offer(lot, now);
  const { price, note } = offerPrice(current);
  return (
    <Link
      to="/lot/$id"
      params={{ id }}
      className="flex w-full max-w-[520px] min-w-0 flex-col gap-1 justify-self-center border bg-card p-[clamp(16px,2vw,24px)] transition-colors hover:border-muted-foreground"
    >
      <Row chain="SOURCE">
        <div className="flex flex-col gap-1 border p-4">
          <span className="font-mono text-xs text-muted-foreground">
            SABLIER STREAM #{lot.source.id}
          </span>
          <span className="text-sm">
            Non-cancelable, non-transferable. It only ever pays one address.
          </span>
        </div>
      </Row>
      <Wire label="pays out every second" />
      <Row chain="BASE">
        <div className="flex flex-col gap-2 border border-primary p-4">
          <span className="flex flex-wrap justify-between gap-x-3 font-mono text-xs">
            <span className="text-primary">ADDRESS · NO PRIVATE KEY</span>
            <span>{shortAddress(address)}</span>
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            VESTED SO FAR · {symbol}
          </span>
          <DitherNumber
            value={Number(formatUnits(vestedNow, decimals))}
            from={Number(formatUnits(vestedNow, decimals))}
            format={{
              minimumFractionDigits: decimals,
              maximumFractionDigits: decimals,
            }}
            size="md"
          />
          <span className="flex flex-wrap justify-between gap-x-3 text-sm">
            <span>{formatPercent(vestedFraction)} vested</span>
            <span className="text-muted-foreground">
              {formatToken(deposit - vestedNow, decimals)} {symbol} to come
            </span>
          </span>
          <ProgressBar
            label="Vested"
            hideLabel
            value={vestedFraction}
            max={1}
            size="sm"
          />
        </div>
      </Row>
      <Wire up label="only the title owner can sign for it" />
      <Row chain="NEAR">
        <div className="flex flex-wrap items-center gap-4 border p-4">
          <LotField
            id={id}
            offer={current.kind}
            size={2}
            className="size-14 shrink-0"
          />
          <span className="flex min-w-[9rem] flex-1 flex-col gap-0.5">
            <span className="font-mono text-xs text-primary">
              NFT TITLE · QUITCLAIM #{id}
            </span>
            <span className="truncate font-mono text-xs text-muted-foreground">
              owner {lot.owner}
            </span>
          </span>
          <span className="shrink-0 sm:text-right">
            <span className="block text-lg font-medium whitespace-nowrap">
              {price}
            </span>
            {note && (
              <span className="font-mono text-xs text-muted-foreground">
                {note}
              </span>
            )}
          </span>
        </div>
      </Row>
      <p className="mt-3 text-xs text-muted-foreground">
        Sell the NFT and the address changes hands. The stream never notices.
      </p>
    </Link>
  );
}
