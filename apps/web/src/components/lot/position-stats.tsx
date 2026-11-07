import type { Position } from "@quitclaim/shared/derive.ts";
import { formatUnits } from "viem";
import { DitherNumber } from "@/components/dithercn/dither-number";
import { date, formatToken } from "@/lib/format";

export function PositionStats({
  position,
  token,
  withdrawn,
  endSec,
}: {
  position: Position;
  token: { symbol: string; decimals: number };
  withdrawn: bigint;
  endSec: number;
}) {
  const fmt = (v: bigint) => formatToken(v, token.decimals);
  const stats = [
    ["In the address", fmt(position.held)],
    ["Claimable from stream", fmt(position.claimable)],
    ["Still locked", fmt(position.locked)],
    ["Stream ends", date(endSec * 1000)],
  ] as const;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">
          Remaining payouts + funds held
        </span>
        <span className="flex items-baseline gap-2">
          <DitherNumber
            value={Number(formatUnits(position.remaining, token.decimals))}
            format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
            size="md"
          />
          <span className="text-sm text-muted-foreground">{token.symbol}</span>
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-5 sm:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-lg font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        Original stream allocation {fmt(position.deposit)} {token.symbol} ·
        Already pulled into the address {fmt(withdrawn)} {token.symbol}
      </p>
    </div>
  );
}
