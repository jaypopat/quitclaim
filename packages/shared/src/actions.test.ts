import { describe, expect, test } from "bun:test";
import { teraToGas } from "near-api-js";
import { actions, type LotAction } from "./actions.ts";
import type { Lot } from "./lot.gen.ts";
import { issued, lot, T0 } from "./testing.ts";

const NOW = T0 * 1000;
const kinds = (l: Lot, viewer: string | null, now = NOW) =>
  actions({ id: 4, lot: l }, viewer, now).map((a) => a.kind);
const find = <K extends LotAction["kind"]>(
  l: Lot,
  viewer: string | null,
  kind: K,
  now = NOW,
) => {
  const action = actions({ id: 4, lot: l }, viewer, now).find(
    (a): a is Extract<LotAction, { kind: K }> => a.kind === kind,
  );
  if (!action) throw new Error(`no ${kind} for ${viewer}`);
  return action;
};

const GAS = teraToGas(300);
const PREP = teraToGas(20);
const AFTER = teraToGas(280);
const floor = { maxFee: 2_000n, maxPrio: 200n };
const clean = (o: Partial<Lot> = {}) => lot({ state: "Clean", ...o });
const lease = (endsMs = NOW + 60_000) => ({
  holder: "bob.testnet",
  start_ms: NOW - 60_000,
  ends_at_ms: endsMs,
  committed: "0",
});

describe("an Active lot", () => {
  test("its owner may sell, offer a lease or withdraw, and nobody else may do anything", () => {
    expect(kinds(lot(), "alice.testnet")).toEqual([
      "list",
      "offer-lease",
      "withdraw",
    ]);
    expect(kinds(lot(), "bob.testnet")).toEqual([]);
    expect(kinds(lot(), null)).toEqual([]);
  });

  test("with nothing issued, selling seals and lists in one transaction", () => {
    expect(find(lot(), "alice.testnet", "list").call(6n)).toEqual([
      {
        method: "seal",
        args: { id: 4, fees: { max_fee: "0", max_prio: "0" } },
        deposit: 1n,
        gas: PREP,
      },
      { method: "list", args: { id: 4, price: "6" }, deposit: 1n, gas: AFTER },
    ]);
    expect(
      find(lot(), "alice.testnet", "offer-lease").call({
        price: 4n,
        endsAtMs: NOW + 1000,
      })[1],
    ).toEqual({
      method: "offer_lease",
      args: { id: 4, price: "4", ends_at_ms: NOW + 1000 },
      deposit: 1n,
      gas: AFTER,
    });
  });

  test("with a signature outstanding it must be burned before a sale", () => {
    const l = lot({
      next_nonce: 2,
      issued: [
        issued({ nonce: 2, fees: { max_fee: "5000", max_prio: "500" } }),
      ],
    });
    expect(kinds(l, "alice.testnet")).toEqual(["withdraw", "seal"]);
    expect(find(l, "alice.testnet", "seal").call(floor)).toEqual({
      method: "seal",
      args: { id: 4, fees: { max_fee: "5501", max_prio: "551" } },
      deposit: 1n,
      gas: GAS,
    });
    const to = "0x000000000000000000000000000000000000a11c";
    expect(
      find(l, "alice.testnet", "withdraw").call({
        to,
        amount: 25_000_000n,
        gasLimit: 60_000,
        floor,
      }),
    ).toEqual([
      {
        method: "request_transfer",
        args: {
          id: 4,
          to,
          amount: "25000000",
          gas_limit: 60_000,
          fees: { max_fee: "5501", max_prio: "551" },
        },
        deposit: 1n,
        gas: GAS,
      },
    ]);
  });

  test("nothing can sign while a sign request is in flight", () => {
    expect(kinds(lot({ sign_in_flight: true }), "alice.testnet")).toEqual([]);
  });

  test("the lessee controls it during a lease, not the owner", () => {
    const leased = lot({ lease: lease() });
    expect(kinds(leased, "bob.testnet")).toEqual([
      "list",
      "withdraw",
      "surrender-lease",
    ]);
    expect(kinds(leased, "alice.testnet")).toEqual([]);
    expect(find(leased, "bob.testnet", "surrender-lease").call[1]).toEqual({
      method: "surrender_lease",
      args: { id: 4 },
      deposit: 1n,
      gas: AFTER,
    });
  });

  test("once the lease runs out anyone may seal and the lessee may not withdraw", () => {
    const ranOut = lot({ lease: lease(NOW - 1) });
    expect(kinds(ranOut, "carol.testnet")).toEqual(["seal"]);
    expect(kinds(ranOut, null)).toEqual(["seal"]);
    expect(kinds(ranOut, "bob.testnet")).toEqual(["seal"]);
  });
});

describe("a Sealing lot", () => {
  test("its controller may unseal and send in one transaction unless a rescue burn is outstanding", () => {
    const sealing = lot({ state: "Sealing", issued: [issued()] });
    expect(kinds(sealing, "alice.testnet")).toEqual(["withdraw"]);
    const rescued = lot({
      state: "Sealing",
      issued: [issued(), issued({ seq: 1, nonce: 1 })],
    });
    expect(kinds(rescued, "alice.testnet")).toEqual([]);
  });
});

describe("a Clean lot", () => {
  test("its owner may sell, offer a lease, or unseal and send in one transaction", () => {
    expect(kinds(clean(), "alice.testnet")).toEqual([
      "list",
      "offer-lease",
      "withdraw",
    ]);
    expect(find(clean(), "alice.testnet", "list").call(6n)).toEqual([
      { method: "list", args: { id: 4, price: "6" }, deposit: 1n, gas: GAS },
    ]);
    const sent = find(clean(), "alice.testnet", "withdraw").call({
      to: "0x000000000000000000000000000000000000a11c",
      amount: 1n,
      gasLimit: 60_000,
      floor,
    });
    expect(sent.map((c) => [c.method, c.gas])).toEqual([
      ["unseal", PREP],
      ["request_transfer", AFTER],
    ]);
  });

  test("a listing is bought at its exact price and the version the buyer saw", () => {
    const listed = clean({
      listing: { item: "Title", price: "9", version: 3 },
    });
    expect(kinds(listed, "bob.testnet")).toEqual(["buy"]);
    expect(kinds(listed, null)).toEqual(["buy"]);
    expect(find(listed, "bob.testnet", "buy").call).toEqual({
      method: "buy",
      args: { id: 4, version: 3 },
      deposit: 9n,
      gas: GAS,
    });
    expect(kinds(listed, "alice.testnet")).toEqual(["delist"]);
  });

  test("a listing bound to an older version can't be bought", () => {
    const stale = clean({ listing: { item: "Title", price: "9", version: 2 } });
    expect(kinds(stale, "bob.testnet")).toEqual([]);
  });

  test("a lease offer is taken at its price and end, never by the owner, never after it ends", () => {
    const offered = clean({
      lease_offer: { price: "4", ends_at_ms: NOW + 5000, version: 3 },
    });
    expect(find(offered, "carol.testnet", "take-lease").call).toEqual({
      method: "take_lease",
      args: { id: 4, version: 3, ends_at_ms: NOW + 5000 },
      deposit: 4n,
      gas: GAS,
    });
    expect(kinds(offered, "alice.testnet")).toEqual(["delist"]);
    expect(kinds(offered, "carol.testnet", NOW + 5000)).toEqual([]);
  });

  test("a lessee may list the lease or surrender it, and the owner can't offer another", () => {
    const leased = clean({ lease: lease() });
    expect(kinds(leased, "bob.testnet")).toEqual([
      "list",
      "withdraw",
      "surrender-lease",
    ]);
    expect(kinds(leased, "alice.testnet")).toEqual([]);
    const listedLease = clean({
      lease: lease(),
      listing: { item: "Lease", price: "3", version: 3 },
    });
    expect(kinds(listedLease, "alice.testnet")).toEqual(["buy"]);
    expect(kinds(listedLease, "bob.testnet")).toEqual([
      "delist",
      "surrender-lease",
    ]);
  });

  test("a lease that ran out is ended by anyone and control is the owner's again", () => {
    const over = clean({ lease: lease(NOW - 1) });
    expect(kinds(over, "carol.testnet")).toEqual(["end-lease"]);
    expect(find(over, null, "end-lease").call).toEqual({
      method: "end_lease",
      args: { id: 4 },
      deposit: 0n,
      gas: GAS,
    });
    expect(kinds(over, "alice.testnet")).toEqual([
      "list",
      "offer-lease",
      "withdraw",
      "end-lease",
    ]);
  });
});
