import type { LotView } from "./lot-view.ts";

/** Where the oldest outstanding tx is. The keeper broadcasts and proves; the page only watches. */
export const OUTSTANDING = ["signing", "signed", "broadcast", "mined"] as const;
export type Outstanding = (typeof OUTSTANDING)[number];

export type Settle =
  | { phase: "idle" }
  | { phase: Outstanding; nonce: number; sealing: boolean }
  | { phase: "clean" };

export function settleProgress(view: Pick<LotView, "lot" | "base">): Settle {
  const { lot, base } = view;
  if (lot.state === "Clean") return { phase: "clean" };
  if (lot.issued.length === 0) return { phase: "idle" };
  const nonce = lot.next_nonce;
  const sealing = lot.state === "Sealing";
  const phase: Outstanding =
    base.nonce > nonce
      ? "mined"
      : base.pendingNonce > nonce
        ? "broadcast"
        : lot.issued.some((i) => i.nonce === nonce && i.tx_hash)
          ? "signed"
          : "signing";
  return { phase, nonce, sealing };
}
