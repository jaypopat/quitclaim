import { describe, expect, test } from "bun:test";
import { settleProgress } from "./settle-progress.ts";
import { issued, lot, view } from "./testing.ts";

describe("settle progress", () => {
  const sealing = (txHash: string | null) =>
    lot({
      state: "Sealing",
      next_nonce: 2,
      issued: [issued({ nonce: 2, tx_hash: txHash })],
    });
  const at = (nonce: number, pendingNonce: number, txHash: string | null) =>
    settleProgress(
      view(sealing(txHash), { base: { held: 0n, nonce, pendingNonce } }),
    );

  test("follows a burn from signing to mined", () => {
    expect(at(2, 2, null)).toEqual({
      phase: "signing",
      nonce: 2,
      sealing: true,
    });
    expect(at(2, 2, "0xaa").phase).toBe("signed");
    expect(at(2, 3, "0xaa").phase).toBe("broadcast");
    expect(at(3, 3, "0xaa").phase).toBe("mined");
  });

  test("is idle with nothing outstanding and done once Clean", () => {
    expect(settleProgress(view())).toEqual({ phase: "idle" });
    expect(settleProgress(view(lot({ state: "Clean" })))).toEqual({
      phase: "clean",
    });
  });

  test("tracks a withdrawal on an Active lot too", () => {
    const l = lot({
      issued: [
        issued({
          kind: { Transfer: { to: "0x1", amount: "5" } },
          tx_hash: "0xbb",
        }),
      ],
    });
    expect(settleProgress(view(l))).toEqual({
      phase: "signed",
      nonce: 0,
      sealing: false,
    });
  });
});
