import { describe, expect, test } from "bun:test";
import {
  history,
  nonceSlots,
  offer,
  position,
  streamChecks,
  titleChecks,
} from "./derive.ts";
import type { StreamCreation } from "./sablier.ts";
import { ADDRESS, issued, lot, T0, TOKEN, view } from "./testing.ts";

const NOW = T0 * 1000;

describe("position", () => {
  test("splits what the title controls into held, claimable and locked", () => {
    const v = view(lot(), {
      base: { held: 7_000_000n, nonce: 0, pendingNonce: 0 },
      stream: { ...view().stream, withdrawn: 20_000_000n },
    });
    expect(position(v, T0 + 250)).toEqual({
      held: 7_000_000n,
      claimable: 5_000_000n,
      locked: 75_000_000n,
      remaining: 87_000_000n,
      deposit: 100_000_000n,
      vestedFraction: 0.25,
    });
  });

  test("before the stream starts everything is locked", () => {
    expect(position(view(), T0 - 1)).toMatchObject({
      claimable: 0n,
      locked: 100_000_000n,
      vestedFraction: 0,
    });
  });
});

describe("offer", () => {
  test("does not advertise stale, expired or non-Clean offers", () => {
    expect(
      offer(
        lot({
          state: "Clean",
          listing: { item: "Title", price: "6", version: 2 },
        }),
        NOW,
      ),
    ).toEqual({ kind: "none" });
    expect(
      offer(
        lot({
          state: "Active",
          listing: { item: "Title", price: "6", version: 3 },
        }),
        NOW,
      ),
    ).toEqual({ kind: "none" });
    expect(
      offer(
        lot({
          state: "Clean",
          lease_offer: { price: "4", ends_at_ms: NOW, version: 3 },
        }),
        NOW,
      ),
    ).toEqual({ kind: "none" });
  });

  test("names whatever the lot is offered as", () => {
    const clean = { state: "Clean" as const };
    expect(
      offer(
        lot({ ...clean, listing: { item: "Title", price: "6", version: 3 } }),
        NOW,
      ),
    ).toEqual({ kind: "sale", item: "Title", price: 6n });
    expect(
      offer(
        lot({
          ...clean,
          lease_offer: { price: "4", ends_at_ms: NOW + 9, version: 3 },
        }),
        NOW,
      ),
    ).toEqual({ kind: "lease-offer", price: 4n, endsAtMs: NOW + 9 });
    const lease = {
      holder: "bob.testnet",
      start_ms: NOW - 5,
      ends_at_ms: NOW + 5,
      committed: "0",
    };
    expect(offer(lot({ lease }), NOW)).toEqual({
      kind: "leased",
      holder: "bob.testnet",
      startMs: NOW - 5,
      endsAtMs: NOW + 5,
    });
    expect(offer(lot({ ...clean, lease }), NOW + 5)).toEqual({ kind: "none" });
    expect(offer(lot(), NOW)).toEqual({ kind: "none" });
  });
});

describe("nonce slots", () => {
  test("show proven nonces used, a mined unproven burn, and outstanding signatures", () => {
    const l = lot({
      state: "Sealing",
      next_nonce: 2,
      issued: [
        issued({ seq: 4, nonce: 2, tx_hash: "0xaa" }),
        issued({ seq: 5, nonce: 3 }),
      ],
    });
    const v = view(l, { base: { held: 0n, nonce: 3, pendingNonce: 3 } });
    expect(nonceSlots(v).map((s) => s.status)).toEqual([
      "used",
      "used",
      "burned",
      "signed-unsent",
      "open",
      "open",
      "open",
      "open",
    ]);
  });

  test("a transfer and a burn at one nonce count as used once mined", () => {
    const l = lot({
      state: "Sealing",
      issued: [
        issued({ kind: { Transfer: { to: "0x1", amount: "5" } } }),
        issued({ seq: 1 }),
      ],
    });
    const v = view(l, { base: { held: 0n, nonce: 1, pendingNonce: 1 } });
    expect(nonceSlots(v)[0]).toEqual({ nonce: 0, status: "used" });
  });

  test("grow past eight when the lot has used more nonces", () => {
    const v = view(lot({ next_nonce: 11 }));
    expect(nonceSlots(v)).toHaveLength(12);
    expect(nonceSlots(v).at(-1)).toEqual({ nonce: 11, status: "open" });
  });
});

describe("title checks", () => {
  const statuses = (v = view(), frozen = false) =>
    titleChecks(v, frozen).map((c) => c.status);

  test("pass on a clean lot in test USDC from a frozen contract", () => {
    expect(statuses(view(lot({ state: "Clean" })), true)).toEqual([
      "pass",
      "pass",
      "pass",
      "pass",
      "pass",
    ]);
  });

  test("warn while the lot can sign and the contract is upgradeable", () => {
    expect(statuses()).toEqual(["pass", "pass", "pass", "warn", "warn"]);
  });

  test("fail when Sablier or MPC disagree with the lot", () => {
    const v = view(lot(), {
      stream: {
        ...view().stream,
        title: { ...view().stream.title, cancelable: true, clean: false },
      },
      derivedAddress: "0x00000000000000000000000000000000000000Bb",
    });
    expect(statuses(v).slice(0, 2)).toEqual(["fail", "fail"]);
  });
});

test("history lists current state before what's already settled", () => {
  const l = lot({
    state: "Clean",
    next_nonce: 3,
    listing: { item: "Title", price: "6", version: 3 },
    issued: [issued({ seq: 1 }), issued({ seq: 2, nonce: 1 })],
  });
  expect(history(l).map((e) => e.kind)).toEqual([
    "listed",
    "issued",
    "issued",
    "proven",
    "stream-started",
  ]);
  expect(history(l)[1]).toMatchObject({ issued: { seq: 2 } });
  expect(history(l).at(-1)).toEqual({
    kind: "stream-started",
    atMs: T0 * 1000,
  });
});

describe("stream checks before minting", () => {
  const stream = (overrides: Partial<StreamCreation> = {}): StreamCreation => ({
    id: 7n,
    block: 1n,
    recipient: ADDRESS,
    token: TOKEN,
    deposit: 5_000_000n,
    startSec: T0,
    endSec: T0 + 86_400,
    cancelable: false,
    transferable: false,
    log: {
      removed: false,
      log_index: 0,
      transaction_index: 0,
      transaction_hash: "aa",
      block_hash: "bb",
      block_number: 1,
      address: "cc",
      data: "0x",
      topics: [],
    },
    ...overrides,
  });
  const statuses = (s: StreamCreation) =>
    streamChecks(s, ADDRESS).map((c) => c.status);

  test("pass for a locked test USDC stream paying the receiving address", () => {
    expect(statuses(stream())).toEqual(["pass", "pass", "pass"]);
  });

  test("fail when it pays elsewhere, can be cancelled or moved, or is another token", () => {
    expect(
      statuses(
        stream({
          recipient: "0x00000000000000000000000000000000000000Bb",
          transferable: true,
          token: "0x2a639c03a65c73d35e8091714a49182f67b7dbfc",
        }),
      ),
    ).toEqual(["fail", "fail", "fail"]);
  });
});
