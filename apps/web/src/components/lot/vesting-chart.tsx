import type { Schedule } from "@quitclaim/shared";
import { vested } from "@quitclaim/shared/vesting.ts";
import { formatUnits } from "viem";
import { useSyncExternalStore } from "react";
import { AreaChart } from "@/components/dithercn/area-chart";
import { dayMonth, monthYear } from "@/lib/format";

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

const onResize = (notify: () => void) => {
  window.addEventListener("resize", notify);
  return () => window.removeEventListener("resize", notify);
};

/** The lot page fits one screen at 160px; taller windows give the spare height to the chart. */
function useChartHeight() {
  const viewport = useSyncExternalStore(onResize, () => window.innerHeight);
  return Math.min(380, Math.max(160, viewport - 680));
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
  const span = schedule.end - schedule.start;
  const label =
    span < 2 * 86_400
      ? time.format
      : span > 300 * 86_400
        ? monthYear
        : dayMonth;
  const height = useChartHeight();
  return (
    <AreaChart
      data={points(schedule, nowSec, decimals)}
      x={(p) => label(p.at * 1000)}
      series={[
        { label: `Vested (${symbol})`, value: "vested", color: "ink" },
        { label: `Still to vest (${symbol})`, value: "toCome", color: "grey" },
      ]}
      stack="stacked"
      curve="linear"
      height={height}
      format={{ maximumFractionDigits: 2 }}
    />
  );
}
