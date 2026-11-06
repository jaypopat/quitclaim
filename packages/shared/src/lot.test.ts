import { expect, test } from "bun:test";
import { nextFees, type Issued } from "./lot.ts";

const issued = (nonce: number, fee: string, prio: string): Issued => ({
  seq: 0,
  nonce,
  kind: "Burn",
  gas_limit: 21000,
  fees: { max_fee: fee, max_prio: prio },
  tx_hash: null,
  raw_tx: null,
});

test("first tx at a nonce uses the floor", () => {
  expect(nextFees([], 0, { maxFee: 100n, maxPrio: 10n })).toEqual({
    max_fee: "100",
    max_prio: "10",
  });
});

test("replacement raises both fees by more than 10% over the highest issued at that nonce", () => {
  const f = nextFees(
    [issued(3, "50000000", "1000000"), issued(3, "55000000", "1100000")],
    3,
    { maxFee: 1n, maxPrio: 1n },
  );
  expect(BigInt(f.max_fee) * 10n >= 55000000n * 11n).toBe(true);
  expect(BigInt(f.max_prio) * 10n >= 1100000n * 11n).toBe(true);
});

test("txs at other nonces do not affect the bump", () => {
  expect(
    nextFees([issued(2, "900", "90")], 3, { maxFee: 100n, maxPrio: 10n }),
  ).toEqual({ max_fee: "100", max_prio: "10" });
});
