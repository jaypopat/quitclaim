import type { Address } from "viem";
import type { FloorFees } from "./base.ts";
import { contractCall, YOCTO, type ContractCall } from "./calls.ts";
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
  | { kind: "unseal"; call: ContractCall<"unseal"> }
  | { kind: "surrender-lease"; call: ContractCall<"surrender_lease"> }
  | { kind: "end-lease"; call: ContractCall<"end_lease"> }
  | { kind: "list"; call: (price: bigint) => ContractCall<"list"> }
  | {
      kind: "offer-lease";
      call: (offer: {
        price: bigint;
        endsAtMs: number;
      }) => ContractCall<"offer_lease">;
    }
  | { kind: "seal"; call: (floor: FloorFees) => ContractCall<"seal"> }
  | {
      kind: "withdraw";
      call: (w: Withdrawal) => ContractCall<"request_transfer">;
    };

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
    make: (lot, { id }) =>
      lot.state === "Clean" && !lot.listing && !lot.lease_offer
        ? {
            kind: "list",
            call: (price) =>
              contractCall("list", { id, price: price.toString() }, YOCTO),
          }
        : undefined,
  },
  {
    who: "owner",
    make: (lot, { id, nowMs }) =>
      lot.state === "Clean" &&
      !liveLease(lot, nowMs) &&
      !lot.listing &&
      !lot.lease_offer
        ? {
            kind: "offer-lease",
            call: ({ price, endsAtMs }) =>
              contractCall(
                "offer_lease",
                { id, price: price.toString(), ends_at_ms: endsAtMs },
                YOCTO,
              ),
          }
        : undefined,
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
    make: (lot, { id, nowMs }) =>
      canSign(lot, nowMs)
        ? {
            kind: "withdraw",
            call: ({ to, amount, gasLimit, floor }) =>
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
          }
        : undefined,
  },
  {
    who: "controller",
    make: (lot, { id, nowMs }) =>
      canSign(lot, nowMs) ? seal(lot, id) : undefined,
  },
  {
    who: "anyone",
    make: (lot, { id, nowMs }) =>
      lot.state === "Active" && !lot.sign_in_flight && runningOut(lot, nowMs)
        ? seal(lot, id)
        : undefined,
  },
  {
    who: "controller",
    make: (lot, { id, nowMs }) =>
      (lot.state === "Sealing" || lot.state === "Clean") &&
      !runningOut(lot, nowMs) &&
      lot.issued.every((i) => i.nonce === lot.next_nonce)
        ? { kind: "unseal", call: contractCall("unseal", { id }, YOCTO) }
        : undefined,
  },
  {
    who: "lease-holder",
    make: (lot, { id }) =>
      lot.state === "Clean"
        ? {
            kind: "surrender-lease",
            call: contractCall("surrender_lease", { id }, YOCTO),
          }
        : undefined,
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
