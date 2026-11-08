import { expect, test } from "bun:test";
import type { Schedule } from "./lot.gen.ts";
import { vested } from "./vesting.ts";

const unit = 10n ** 18n;
const schedule = (s: {
  deposit: bigint;
  start: number;
  cliff: number;
  end: number;
  granularity: number;
  startUnlock?: bigint;
}): Schedule => ({
  deposit: s.deposit.toString(),
  start: s.start,
  cliff: s.cliff,
  end: s.end,
  granularity: s.granularity,
  start_unlock: (s.startUnlock ?? 0n).toString(),
  cliff_unlock: "0",
});

// The same `streamedAmountOf` reads the contract's Rust tests pin (contracts/lot/src/tests.rs).
test("matches Sablier on stream 112's real creation log", () => {
  const s = schedule({
    deposit: 1_000n * unit,
    start: 1793879782,
    cliff: 0,
    end: 1793883382,
    granularity: 1,
  });
  expect(vested(s, 1793880382)).toBe(166_666_666_666_666_666_666n);
  expect(vested(s, 1793881582)).toBe(500n * unit);
  expect(vested(s, 1793883381)).toBe(999_722_222_222_222_222_222n);
  expect(vested(s, 1793883500)).toBe(1_000n * unit);
});

test("matches Sablier across cliffs, unlocks and granularity", () => {
  const cases: [string, Schedule, number, bigint][] = [
    [
      "76: cliff ahead, start unlock",
      schedule({
        deposit: 1_000n * unit,
        start: 1790208000,
        cliff: 1805846400,
        end: 1821744000,
        granularity: 1,
        startUnlock: 100n * unit,
      }),
      1793911308,
      100n * unit,
    ],
    [
      "99: no cliff, start unlock",
      schedule({
        deposit: 20_000n * unit,
        start: 1791169008,
        cliff: 0,
        end: 1822705008,
        granularity: 1,
        startUnlock: 2_000n * unit,
      }),
      1793911332,
      3_565_253_424_657_534_246_575n,
    ],
    [
      "53: past the cliff",
      schedule({
        deposit: 200_000_000_000_000n,
        start: 1784100080,
        cliff: 1786692080,
        end: 1815636080,
        granularity: 1,
      }),
      1793911344,
      49_884_355_997_788n,
    ],
    [
      "45: ended, daily granularity",
      schedule({
        deposit: 5_000n * unit,
        start: 1779539575,
        cliff: 0,
        end: 1782522000,
        granularity: 86_400,
      }),
      1793911345,
      5_000n * unit,
    ],
  ];
  for (const [name, s, t, streamed] of cases)
    expect(vested(s, t), name).toBe(streamed);
});

test("vests only whole granularity units, and nothing before the start", () => {
  const daily = schedule({
    deposit: 1_000n,
    start: 0,
    cliff: 0,
    end: 864_000,
    granularity: 86_400,
  });
  expect(vested(daily, 86_399)).toBe(0n);
  expect(vested(daily, 3 * 86_400 + 5_000)).toBe(300n);
  expect(vested({ ...daily, start: 10 }, 9)).toBe(0n);
});

test("a wall-clock time between seconds vests what its whole second does", () => {
  const s = schedule({
    deposit: 1_000n * unit,
    start: 100,
    cliff: 0,
    end: 1_100,
    granularity: 1,
  });
  expect(vested(s, 101.47000002861023)).toBe(vested(s, 101));
  expect(vested(s, 101.47000002861023)).toBe(1n * unit);
});
