/** What a lot page shows, derived from a `LotView` with no further reads. */
import { config } from "./config.ts";
import { liveLease } from "./control.ts";
import type { Issued, Item, Lot } from "./lot.gen.ts";
import { isBurn } from "./lot.ts";
import type { LotView } from "./lot-view.ts";
import { vested } from "./vesting.ts";

export type Position = {
  /** Already at the lot address. */
  held: bigint;
  /** Vested in the stream, not yet pulled into the lot. */
  claimable: bigint;
  /** Not vested yet. */
  locked: bigint;
  /** Everything the title still controls: held + claimable + locked. */
  remaining: bigint;
  deposit: bigint;
  vestedFraction: number;
};

export function position(view: LotView, nowSec: number): Position {
  const { schedule } = view.lot.source;
  const deposit = BigInt(schedule.deposit);
  const vestedNow = vested(schedule, nowSec);
  const claimable =
    vestedNow > view.stream.withdrawn ? vestedNow - view.stream.withdrawn : 0n;
  const locked = deposit - vestedNow;
  return {
    held: view.base.held,
    claimable,
    locked,
    remaining: view.base.held + claimable + locked,
    deposit,
    vestedFraction: Number((vestedNow * 10_000n) / deposit) / 10_000,
  };
}

export type Offer =
  | { kind: "sale"; item: Item; price: bigint }
  | { kind: "lease-offer"; price: bigint; endsAtMs: number }
  | { kind: "leased"; holder: string; startMs: number; endsAtMs: number }
  | { kind: "none" };

export function offer(lot: Lot, nowMs: number): Offer {
  if (lot.listing)
    return {
      kind: "sale",
      item: lot.listing.item,
      price: BigInt(lot.listing.price),
    };
  if (lot.lease_offer)
    return {
      kind: "lease-offer",
      price: BigInt(lot.lease_offer.price),
      endsAtMs: lot.lease_offer.ends_at_ms,
    };
  const lease = liveLease(lot, nowMs);
  if (lease)
    return {
      kind: "leased",
      holder: lease.holder,
      startMs: lease.start_ms,
      endsAtMs: lease.ends_at_ms,
    };
  return { kind: "none" };
}

export type NonceStatus = "used" | "burned" | "signed-unsent" | "open";
export type NonceSlot = { nonce: number; status: NonceStatus };

const MIN_SLOTS = 8;

/**
 * One slot per Base nonce of the lot address. Below the Base nonce a slot is spent: `burned` when
 * every tx the contract still records there is a burn, else `used`. At or above it, a slot with an
 * issued tx is `signed-unsent`, because MPC signatures are public the moment they exist.
 */
export function nonceSlots(view: LotView): NonceSlot[] {
  const { issued } = view.lot;
  const top = Math.max(view.base.nonce, ...issued.map((i) => i.nonce + 1));
  return Array.from({ length: Math.max(MIN_SLOTS, top + 1) }, (_, nonce) => {
    const at = issued.filter((i) => i.nonce === nonce);
    const status: NonceStatus =
      nonce < view.base.nonce
        ? at.length > 0 && at.every(isBurn)
          ? "burned"
          : "used"
        : at.length > 0
          ? "signed-unsent"
          : "open";
    return { nonce, status };
  });
}

export type TitleCheck = {
  label: string;
  plain: string;
  status: "pass" | "warn" | "fail";
};

export function titleChecks(view: LotView, frozen: boolean): TitleCheck[] {
  const { lot, stream, token } = view;
  const testUsdc =
    token.address.toLowerCase() === config.evm.token.toLowerCase();
  return [
    stream.title.clean
      ? {
          label: "Minted from a locked stream",
          plain: "Non-cancelable, non-transferable, paying this address.",
          status: "pass",
        }
      : {
          label: "Stream no longer matches",
          plain:
            "Sablier no longer reports a locked stream paying this address in its token.",
          status: "fail",
        },
    view.derivedAddress === view.address
      ? {
          label: "No private key handed to holders",
          plain:
            "MPC derives this address from the lot contract and its path, and signs only what the contract asks. This relies on honest MPC behaviour.",
          status: "pass",
        }
      : {
          label: "Address mismatch",
          plain: `MPC derives ${view.derivedAddress} for this lot's path, not this address.`,
          status: "fail",
        },
    testUsdc
      ? {
          label: "Test USDC",
          plain: "Tidepool test USDC on Base Sepolia. No financial value.",
          status: "pass",
        }
      : {
          label: "Older test token",
          plain: `Holds ${token.symbol}, a test ERC-20 from an earlier run. No financial value.`,
          status: "warn",
        },
    lot.state === "Clean"
      ? {
          label: "Every issued nonce is consumed",
          plain: "Nothing the owner signed earlier can land after a sale.",
          status: "pass",
        }
      : {
          label: "Not sealed for transfer",
          plain:
            "The controller can still sign. A sale seals first, burns anything outstanding, and waits for NEAR to verify the burn.",
          status: "warn",
        },
    frozen
      ? {
          label: "Contract frozen",
          plain:
            "Every full-access key on the lot contract is deleted, so nobody can change it.",
          status: "pass",
        }
      : {
          label: "Contract not frozen yet",
          plain:
            "This testnet deploy can still be upgraded. The final one will not.",
          status: "warn",
        },
  ];
}

export type HistoryEntry =
  | { kind: "listed"; item: Item; price: bigint }
  | { kind: "lease-offered"; price: bigint; endsAtMs: number }
  | { kind: "issued"; issued: Issued }
  | { kind: "leased"; holder: string; atMs: number; endsAtMs: number }
  | { kind: "proven"; through: number }
  | { kind: "stream-started"; atMs: number };

/** Newest first. Only what contract state records: there is no event index behind this. */
export function history(lot: Lot): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  if (lot.listing)
    entries.push({
      kind: "listed",
      item: lot.listing.item,
      price: BigInt(lot.listing.price),
    });
  if (lot.lease_offer)
    entries.push({
      kind: "lease-offered",
      price: BigInt(lot.lease_offer.price),
      endsAtMs: lot.lease_offer.ends_at_ms,
    });
  entries.push(
    ...lot.issued
      .toSorted((a, b) => b.seq - a.seq)
      .map((issued) => ({ kind: "issued" as const, issued })),
  );
  if (lot.lease)
    entries.push({
      kind: "leased",
      holder: lot.lease.holder,
      atMs: lot.lease.start_ms,
      endsAtMs: lot.lease.ends_at_ms,
    });
  if (lot.next_nonce > 0)
    entries.push({ kind: "proven", through: lot.next_nonce - 1 });
  entries.push({
    kind: "stream-started",
    atMs: lot.source.schedule.start * 1000,
  });
  return entries;
}
