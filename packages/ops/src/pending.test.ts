import { expect, test } from "bun:test";
import { pendingLots } from "./pending.ts";

test("discovers pending lots beyond the first page with bounded reads", async () => {
  const tokens = Array.from({ length: 205 }, (_, i) => ({ token_id: String(i * 2) }));
  const reads: [string, number][] = [];
  let active = 0;
  let peak = 0;
  const ids = await Array.fromAsync(pendingLots(
    async (offset, limit) => {
      expect(active).toBe(0);
      reads.push([offset, limit]);
      return tokens.slice(Number(offset), Number(offset) + limit);
    },
    async (id) => {
      peak = Math.max(peak, ++active);
      await Promise.resolve();
      active--;
      return id === 2 || id === 402;
    },
  ));
  expect(ids).toEqual([2, 402]);
  expect(reads).toEqual([["0", 100], ["100", 100], ["200", 100]]);
  expect(peak).toBeLessThanOrEqual(100);
});

test("an empty final page ends discovery without inspecting any lots", async () => {
  const ids = await Array.fromAsync(pendingLots(async () => [], async () => {
    throw new Error("empty page must not trigger a lot query");
  }));
  expect(ids).toEqual([]);
});
