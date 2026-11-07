import type { Schedule } from "@quitclaim/shared";
import { vested } from "@quitclaim/shared/vesting.ts";
import { formatUnits } from "viem";
import { AreaChart } from "@/components/dithercn/area-chart";
import { dayMonth } from "@/lib/format";

const SAMPLES = 48;
const time = new Intl.DateTimeFormat("en-US", { timeStyle: "short" });

type Point = { at: number; vested: number; toCome: number };

/** Sablier's schedule from start to end: vested so far, and what is still to vest above it. */
function points(schedule: Schedule, nowSec: number, decimals: number) {
  const { start, end } = schedule;
  const at = Array.from(
    { length: SAMPLES + 1 },
    (_, i) => start + Math.round(((end - start) * i) / SAMPLES),
  );
  if (nowSec > start && nowSec < end) at.push(nowSec);
  const amount = (t: number) =>
    Number(formatUnits(vested(schedule, t), decimals));
  const sofar = amount(nowSec);
  return at
    .toSorted((a, b) => a - b)
    .map((t): Point => ({
      at: t,
      vested: Math.min(amount(t), sofar),
      toCome: Math.max(amount(t) - sofar, 0),
    }));
}

export function VestingChart({
  schedule,
  nowSec,
  decimals,
  symbol,
}: {
  schedule: Schedule;
  nowSec: number;
  decimals: number;
  symbol: string;
}) {
  const short = schedule.end - schedule.start < 2 * 86_400;
  return (
    <AreaChart
      data={points(schedule, nowSec, decimals)}
      x={(p) => (short ? time.format(p.at * 1000) : dayMonth(p.at * 1000))}
      series={[
        { label: `Vested (${symbol})`, value: "vested", color: "ink" },
        { label: `Still to vest (${symbol})`, value: "toCome", color: "grey" },
      ]}
      stack="stacked"
      curve="linear"
      height={220}
      format={{ maximumFractionDigits: 2 }}
    />
  );
}
