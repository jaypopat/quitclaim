import { expect, test } from "bun:test";
import type { SettleStep } from "@quitclaim/chain/settle.ts";
import * as base from "@quitclaim/chain/base.ts";
import { settleLinks } from "./report.ts";

test("settlement reports retain links for every action and omit broadcasts with no hash", () => {
  const tx = `0x${"11".repeat(32)}` as const;
  const outcome = {
    ok: true,
    value: true,
    tx: "near-tx",
    url: "near-url",
  } as const;
  const steps: SettleStep[] = [
    { kind: "seal", outcome },
    { kind: "end_lease", outcome },
    { kind: "topup", seq: 1, tx },
    { kind: "broadcast", seq: 1, result: { status: "sent", hash: tx } },
    { kind: "mined", seq: 1, tx, block: 42n, status: "success" },
    { kind: "rescue", outcome },
    { kind: "rebump", nonce: 3, outcome },
    { kind: "prove", seq: 1, outcome },
    {
      kind: "broadcast",
      seq: 1,
      result: { status: "nonce-too-low", message: "consumed" },
    },
    {
      kind: "broadcast",
      seq: 1,
      result: { status: "error", message: "offline" },
    },
  ];
  expect(settleLinks(steps)).toEqual([
    "seal near-url",
    "end lease near-url",
    `top-up ${base.txUrl(tx)}`,
    `broadcast ${base.txUrl(tx)}`,
    `mined (success) block 42 ${base.txUrl(tx)}`,
    "rescue near-url",
    "rebump nonce 3 near-url",
    "prove near-url",
  ]);
});
