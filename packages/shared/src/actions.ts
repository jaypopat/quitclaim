import type { Address } from "viem";
import type { FloorFees } from "./base.ts";
import {
  after,
  contractCall,
  YOCTO,
  type ContractCall,
  type Tx,
} from "./calls.ts";
import { controller, leaseRunOut, liveLease } from "./control.ts";
import type { Lot } from "./lot.gen.ts";
import { nextFees } from "./lot.ts";
import type { LotView } from "./lot-view.ts";

export type Viewer = string | null;

export type Withdrawal = {
  to: Address;
  amount: bigint;
  gasLimit: number;
  floor: FloorFees;
};

/** One contract method each. Calls that need input or live Base fees are builders. */
export type LotAction =
  | { kind: "buy"; call: ContractCall<"buy"> }
  | { kind: "take-lease"; call: ContractCall<"take_lease"> }
  | { kind: "delist"; call: ContractCall<"delist"> }
  | { kind: "surrender-lease"; call: Tx }
  | { kind: "end-lease"; call: ContractCall<"end_lease"> }
  | { kind: "list"; call: (price: bigint) => Tx }
  | {
      kind: "offer-lease";
      call: (offer: { price: bigint; endsAtMs: number }) => Tx;
    }
  | { kind: "seal"; call: (floor: FloorFees) => ContractCall<"seal"> }
  | { kind: "withdraw"; call: (w: Withdrawal) => Tx };

type Role = "controller" | "owner" | "lease-holder" | "anyone";
type Ctx = { id: number; viewer: Viewer; nowMs: number };

const holds: Record<Role, (lot: Lot, ctx: Ctx) => boolean> = {
  controller: (lot, { viewer, nowMs }) => viewer === controller(lot, nowMs),
  owner: (lot, { viewer }) => viewer === lot.owner,
  "lease-holder": (lot, { viewer, nowMs }) =>
    viewer === liveLease(lot, nowMs)?.holder,
  anyone: () => true,
};

/** Clean and bound to the current version, as `buy` and `take_lease` require. */
const current = (lot: Lot, offer: { version: number } | null | undefined) =>
  lot.state === "Clean" && offer?.version === lot.version;

/** A live lease past its end. On a Clean lot the next call closes the lease instead (`load_mut`). */
const runningOut = (lot: Lot, nowMs: number) =>
  !!liveLease(lot, nowMs) && leaseRunOut(lot, nowMs);

const canSign = (lot: Lot, nowMs: number) =>
  lot.state === "Active" && !lot.sign_in_flight && !runningOut(lot, nowMs);

const unlisted = (lot: Lot) => !lot.listing && !lot.lease_offer;

/** Sealing a lot with nothing issued makes it Clean in the same call, so a sale, lease offer or surrender can follow it in one transaction. */
const fromClean = (lot: Lot, id: number, nowMs: number) => {
  if (lot.state === "Clean" && unlisted(lot))
    return (call: ContractCall): Tx => [call];
  if (canSign(lot, nowMs) && !lot.issued.length)
    return (call: ContractCall) =>
      after(contractCall("seal", { id, fees: NO_FEES }, YOCTO), call);
};

/** `seal` reads fees only when it has a burn to sign, and a lot with nothing issued has none. */
const NO_FEES = { max_fee: "0", max_prio: "0" };

/** Unsealing returns a sealed, unlisted lot to Active, so a transfer can follow it in one transaction. */
const toActive = (lot: Lot, id: number, nowMs: number) => {
  if (canSign(lot, nowMs)) return (call: ContractCall): Tx => [call];
  if (
    (lot.state === "Sealing" || lot.state === "Clean") &&
    unlisted(lot) &&
    !runningOut(lot, nowMs) &&
    lot.issued.every((i) => i.nonce === lot.next_nonce)
  )
    return (call: ContractCall) =>
      after(contractCall("unseal", { id }, YOCTO), call);
};

/** Who may do what, by lot state. The contract re-checks every condition; this only decides what to offer. */
const rules: {
  who: Role;
  make: (lot: Lot, ctx: Ctx) => LotAction | undefined;
}[] = [
  {
    who: "anyone",
    make: (lot, { id, viewer, nowMs }) => {
      const listing = lot.listing;
      if (!listing || !current(lot, listing)) return;
      const seller =
        listing.item === "Title" ? lot.owner : liveLease(lot, nowMs)?.holder;
      if (viewer === seller) return;
      const args = { id, version: lot.version };
      return {
        kind: "buy",
        call: contractCall("buy", args, BigInt(listing.price)),
      };
    },
  },
  {
    who: "anyone",
    make: (lot, { id, viewer, nowMs }) => {
      const offer = lot.lease_offer;
      if (!offer || !current(lot, offer) || viewer === lot.owner) return;
      if (nowMs >= offer.ends_at_ms || liveLease(lot, nowMs)) return;
      const args = { id, version: lot.version, ends_at_ms: offer.ends_at_ms };
      return {
        kind: "take-lease",
        call: contractCall("take_lease", args, BigInt(offer.price)),
      };
    },
  },
  {
    who: "controller",
    make: (lot, { id, nowMs }) => {
      const tx = fromClean(lot, id, nowMs);
      if (!tx) return;
      return {
        kind: "list",
        call: (price) =>
          tx(contractCall("list", { id, price: price.toString() }, YOCTO)),
      };
    },
  },
  {
    who: "owner",
    make: (lot, { id, nowMs }) => {
      const tx = !liveLease(lot, nowMs) && fromClean(lot, id, nowMs);
      if (!tx) return;
      return {
        kind: "offer-lease",
        call: ({ price, endsAtMs }) =>
          tx(
            contractCall(
              "offer_lease",
              { id, price: price.toString(), ends_at_ms: endsAtMs },
              YOCTO,
            ),
          ),
      };
    },
  },
  {
    who: "controller",
    make: (lot, { id }) =>
      lot.listing || lot.lease_offer
        ? { kind: "delist", call: contractCall("delist", { id }, YOCTO) }
        : undefined,
  },
  {
    who: "controller",
    make: (lot, { id, nowMs }) => {
      const tx = toActive(lot, id, nowMs);
      if (!tx) return;
      return {
        kind: "withdraw",
        call: ({ to, amount, gasLimit, floor }) =>
          tx(
            contractCall(
              "request_transfer",
              {
                id,
                to,
                amount: amount.toString(),
                gas_limit: gasLimit,
                fees: nextFees(lot.issued, lot.next_nonce, floor),
              },
              YOCTO,
            ),
          ),
      };
    },
  },
  {
    who: "controller",
    make: (lot, { id, nowMs }) =>
      canSign(lot, nowMs) && lot.issued.length ? seal(lot, id) : undefined,
  },
  {
    who: "anyone",
    make: (lot, { id, nowMs }) =>
      lot.state === "Active" && !lot.sign_in_flight && runningOut(lot, nowMs)
        ? seal(lot, id)
        : undefined,
  },
  {
    who: "lease-holder",
    make: (lot, { id, nowMs }) => {
      const tx =
        lot.state === "Clean"
          ? (call: ContractCall): Tx => [call]
          : fromClean(lot, id, nowMs);
      if (!tx) return;
      return {
        kind: "surrender-lease",
        call: tx(contractCall("surrender_lease", { id }, YOCTO)),
      };
    },
  },
  {
    who: "anyone",
    make: (lot, { id, nowMs }) =>
      lot.state === "Clean" && leaseRunOut(lot, nowMs)
        ? { kind: "end-lease", call: contractCall("end_lease", { id }) }
        : undefined,
  },
];

function seal(lot: Lot, id: number): LotAction {
  return {
    kind: "seal",
    call: (floor) =>
      contractCall(
        "seal",
        { id, fees: nextFees(lot.issued, lot.next_nonce, floor) },
        YOCTO,
      ),
  };
}

/** What `viewer` may do to this lot now. A disconnected viewer sees what any account could do. */
export function actions(
  view: Pick<LotView, "id" | "lot">,
  viewer: Viewer,
  nowMs: number,
): LotAction[] {
  const ctx = { id: view.id, viewer, nowMs };
  return rules.flatMap(({ who, make }) => {
    if (!holds[who](view.lot, ctx)) return [];
    const action = make(view.lot, ctx);
    return action ? [action] : [];
  });
}
