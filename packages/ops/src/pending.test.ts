import { expect, test } from "bun:test";
import { pendingLots } from "./pending.ts";

test("discovers pending lots beyond the first page with bounded reads", async () => {
  const tokens = Array.from({ length: 205 }, (_, i) => ({ token_id: String(i * 2) }));
  const reads: [string, number][] = [];
  let active = 0;
  let peak = 0;
  const ids = await pendingLots(
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
  );
  expect(ids).toEqual([2, 402]);
  expect(reads).toEqual([["0", 100], ["100", 100], ["200", 100]]);
  expect(peak).toBeLessThanOrEqual(100);
});

test("an empty final page ends discovery without inspecting any lots", async () => {
  const ids = await pendingLots(async () => [], async () => {
    throw new Error("empty page must not trigger a lot query");
  });
  expect(ids).toEqual([]);
});

test("lease tokens are skipped but still count toward the page offset", async () => {
  const tokens = [{ token_id: "0" }, { token_id: "0-lease" }, ...Array.from({ length: 100 }, (_, i) => ({ token_id: String(i + 1) }))];
  const reads: string[] = [];
  const inspected: number[] = [];
  await pendingLots(
    async (offset, limit) => {
      reads.push(offset);
      return tokens.slice(Number(offset), Number(offset) + limit);
    },
    async (id) => {
      inspected.push(id);
      return false;
    },
  );
  expect(reads).toEqual(["0", "100"]);
  expect(inspected).toEqual(Array.from({ length: 101 }, (_, i) => i));
});

test("settling a page that closes leases neither breaks nor skips the next page", async () => {
  let tokens = Array.from({ length: 51 }, (_, i) => [{ token_id: String(i) }, { token_id: `${i}-lease` }]).flat();
  const settled: number[] = [];
  for (const id of await pendingLots(
    async (offset, limit) => {
      if (Number(offset) > tokens.length) throw new Error("Out of bounds, please use a smaller from_index.");
      return tokens.slice(Number(offset), Number(offset) + limit);
    },
    async () => true,
  )) {
    tokens = tokens.filter((token) => token.token_id !== `${id}-lease`);
    settled.push(id);
  }
  expect(settled).toEqual(Array.from({ length: 51 }, (_, i) => i));
});
