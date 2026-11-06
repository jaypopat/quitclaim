import { expect, test } from "bun:test";
import { provenMined, type SettleStep } from "./keeper.ts";

const hash = `0x${"11".repeat(32)}` as const;
const proof = (seq: number, value: boolean): SettleStep => ({
  kind: "prove",
  seq,
  outcome: { ok: true, value, tx: "proof", url: "proof" },
});
const mined = (
  seq: number,
  status: "success" | "reverted" = "success",
): SettleStep => ({
  kind: "mined",
  seq,
  tx: hash,
  block: 1n,
  status,
});

test("evidence pairs a successful proof with its own mined transaction", () => {
  const result = provenMined([mined(1), mined(2), proof(2, true)]);
  expect(result?.proof.seq).toBe(2);
  expect(result?.mined.seq).toBe(2);
});

test("a failed proof, reverted transaction, or missing matching transaction supplies no evidence", () => {
  for (const steps of [
    [mined(1), proof(1, false)],
    [mined(1, "reverted"), proof(1, true)],
    [mined(1), proof(2, true)],
  ]) {
    expect(provenMined(steps)).toBeUndefined();
  }
});
