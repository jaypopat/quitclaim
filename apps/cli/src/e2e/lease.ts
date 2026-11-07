/**
 * Leases: Alice leases her Clean lot to Bob, who can't be held to a term she shortens after he read
 * it. Alice is locked out; Bob moves out only what the stream vests during the lease, keeps a signed
 * transfer, seals, and resells the lease to Carol, and Base rejects his kept transfer. At expiry the
 * keeper seals and proves, the lease token burns, Carol's kept transfer is rejected, and Alice
 * withdraws again.
 */
import * as base from "@quitclaim/sdk/base.ts";
import { settle } from "@quitclaim/sdk/settle.ts";
import {
  buy,
  leaseLeft,
  list,
  offerLease,
  provision,
  requestTransfer,
  seal,
  takeLease,
} from "@quitclaim/sdk/lot.ts";
import { call, getFinality, view, YOCTO } from "@quitclaim/sdk/near.ts";
import {
  alice,
  aliceEvm,
  bob,
  bobEvm,
  carol,
  carolEvm,
  contract,
  keeper,
  lotOf,
  minter,
  PRICE,
  proceeds,
  raw,
  royalty,
  ROYALTY_BPS,
  transferTitle,
  withdrawTo,
} from "./context.ts";
import { firstLine, settleLinks, type Run } from "./report.ts";

export async function lease(run: Run) {
  const p = await provision({
    contract,
    name: `e2e-lease-${run.started.getTime()}`,
    owner: alice,
    minter,
    royaltyBps: ROYALTY_BPS,
  });
  run.lots.push({ id: p.id, address: p.address });
  run.record({
    step: "provision",
    expect: "fresh lot with a clean Sablier stream",
    got: `lot ${p.id} at ${p.address}, stream ${p.streamId}`,
    pass: p.title.clean,
    links: [p.mint.url],
  });
  const id = p.id;
  const leaseToken = `${id}-lease`;

  const s0 = await seal(contract, alice, id);
  const clean = await lotOf(id);
  run.record({
    step: "alice seals",
    expect: "nothing outstanding: Clean at once",
    got: `${clean.state} v${clean.version}`,
    pass: s0.ok && clean.state === "Clean",
    links: [s0.url],
  });

  // The term must outlast three proofs at the contract's finality: Bob's withdrawal, his seal, Carol's withdrawal.
  const term =
    (await getFinality(contract)) === "Latest" ? 5 * 60_000 : 40 * 60_000;
  const endsAt = Date.now() + term;
  const offer = await offerLease(contract, alice, id, PRICE, endsAt);
  const offered = await lotOf(id);
  run.record({
    step: "alice offers a lease",
    expect: `a ${term / 60_000}-minute lease, bound to the current version`,
    got: `ends ${new Date(endsAt).toISOString()}, price ${offered.lease_offer?.price}, version ${offered.lease_offer?.version}`,
    pass: offer.ok && offered.lease_offer?.version === offered.version,
    links: [offer.url],
  });

  const quoted = offered.lease_offer;
  if (!quoted) throw new Error(`lot ${id} has no lease offer`);
  const shortened = await offerLease(
    contract,
    alice,
    id,
    PRICE,
    Date.now() + 60_000,
  );
  const stale = await takeLease(contract, bob, id, quoted);
  const restored = await offerLease(contract, alice, id, PRICE, endsAt);
  run.record({
    step: "alice shortens the offer after bob read it",
    expect:
      "same price and version, so bob's take of the term he read is refused",
    got: stale.ok ? "taken!" : stale.error,
    pass:
      shortened.ok &&
      !stale.ok &&
      stale.error.includes("the lease offer ends at a different time") &&
      restored.ok,
    links: [shortened.url, stale.url, restored.url],
  });

  const [aliceBefore, minterBefore] = [
    await proceeds(alice),
    await proceeds(minter),
  ];
  const take = await takeLease(contract, bob, id);
  const taken = await lotOf(id);
  const token = await view(contract, "nft_token", { token_id: leaseToken });
  const [aliceGot, minterGot] = [
    (await proceeds(alice)) - aliceBefore,
    (await proceeds(minter)) - minterBefore,
  ];
  run.record({
    step: "bob takes the lease",
    expect:
      "the lease token is bob's, the lot is Active for him, alice and the minter (2.5%) are credited",
    got: `${token?.token_id} owned by ${token?.owner_id}; ${taken.state} v${taken.version}; alice +${aliceGot}, minter +${minterGot}`,
    pass:
      take.ok &&
      taken.lease?.holder === bob &&
      token?.owner_id === bob &&
      taken.state === "Active" &&
      aliceGot === PRICE - royalty &&
      minterGot === royalty,
    links: [take.url],
  });

  const ownerRequest = await requestTransfer(contract, alice, id, aliceEvm, {
    amount: 1n,
    gasLimit: 80_000,
  });
  run.record({
    step: "alice requests during the lease",
    expect: "refused: the lease holder controls the lot",
    got: ownerRequest.ok ? "signed!" : ownerRequest.error,
    pass:
      !ownerRequest.ok && ownerRequest.error.includes("not the lot controller"),
    links: [ownerRequest.url],
  });

  const bobBefore = await base.tokenBalance(p.token, bobEvm);
  const budget = await leaseLeft(contract, id);
  const w0 = await withdrawTo(bob, id, bobEvm, { amount: budget });
  const s1 = await settle(contract, keeper, id);
  const bobGot = (await base.tokenBalance(p.token, bobEvm)) - bobBefore;
  run.record({
    step: "bob withdraws within the budget",
    expect: "everything vested since the lease began; proven, still Active",
    got: `budget ${budget}, bob +${bobGot}, ${s1.lot.state}`,
    pass:
      w0.req.ok && s1.proven && bobGot === budget && s1.lot.state === "Active",
    links: [...w0.links, ...settleLinks(s1.steps)],
  });

  const over = await requestTransfer(contract, bob, id, bobEvm, {
    amount: (await leaseLeft(contract, id)) + 10n ** 24n,
    gasLimit: 80_000,
  });
  run.record({
    step: "bob requests over the budget",
    expect: "refused: more than the stream has vested during the lease",
    got: over.ok ? "signed!" : over.error,
    pass: !over.ok && over.error.includes("over the lease budget"),
    links: [over.url],
  });

  const w1 = await withdrawTo(bob, id, bobEvm, {
    amount: await leaseLeft(contract, id),
  });
  const bobRetained = raw(w1.req);
  run.record({
    step: "bob keeps a signed transfer",
    expect: "a valid transfer(to=bob) within the budget, never broadcast",
    got: bobRetained ? "signed and kept" : w1.req.ok ? "no raw" : w1.req.error,
    pass: !!bobRetained,
    links: w1.links,
  });

  const bs = await seal(contract, bob, id);
  const s2 = await settle(contract, keeper, id);
  run.record({
    step: "bob seals and the burn is proven",
    expect: "Clean, and bob still holds the lease",
    got: `${s2.lot.state}, lease holder ${s2.lot.lease?.holder}`,
    pass: bs.ok && s2.lot.state === "Clean" && s2.lot.lease?.holder === bob,
    links: [bs.url, ...settleLinks(s2.steps)],
  });

  const titleMove = await transferTitle(alice, id, carol);
  run.record({
    step: "alice transfers the title during the lease",
    expect: "refused, even while Clean",
    got: titleMove.ok ? "moved!" : titleMove.error,
    pass:
      !titleMove.ok &&
      titleMove.error.includes("the title can't move during a lease"),
    links: [titleMove.url],
  });

  const l = await list(contract, bob, id, PRICE);
  const listed = await lotOf(id);
  run.record({
    step: "bob lists the lease",
    expect: "the listing is for the lease, bound to the current version",
    got: `${listed.listing?.item} at ${listed.listing?.price}, version ${listed.listing?.version}`,
    pass:
      l.ok &&
      listed.listing?.item === "Lease" &&
      listed.listing.version === listed.version,
    links: [l.url],
  });

  const [sellerBefore, minterBeforeResale] = [
    await proceeds(bob),
    await proceeds(minter),
  ];
  const committed = listed.lease?.committed;
  const sale = await buy(contract, carol, id);
  const resold = await lotOf(id);
  const [sellerGot, minterGotAgain] = [
    (await proceeds(bob)) - sellerBefore,
    (await proceeds(minter)) - minterBeforeResale,
  ];
  run.record({
    step: "carol buys the lease",
    expect:
      "carol holds the lease with bob's spent budget; alice keeps the title; bob and the minter are credited",
    got: `holder ${resold.lease?.holder}, owner ${resold.owner}, committed ${resold.lease?.committed}; bob +${sellerGot}, minter +${minterGotAgain}`,
    pass:
      sale.ok &&
      resold.lease?.holder === carol &&
      resold.owner === alice &&
      resold.lease.committed === committed &&
      sellerGot === PRICE - royalty &&
      minterGotAgain === royalty,
    links: [sale.url],
  });

  const bobHeist = bobRetained ? await base.broadcast(bobRetained) : null;
  run.record({
    step: "bob broadcasts his kept transfer",
    expect: "Base rejects it: its nonce was consumed",
    got: firstLine(bobHeist),
    pass: bobHeist?.status === "nonce-too-low",
  });

  const carolBefore = await base.tokenBalance(p.token, carolEvm);
  const carolBudget = await leaseLeft(contract, id);
  const w2 = await withdrawTo(carol, id, carolEvm, { amount: carolBudget });
  const s3 = await settle(contract, keeper, id);
  const carolGot = (await base.tokenBalance(p.token, carolEvm)) - carolBefore;
  run.record({
    step: "carol withdraws within the budget",
    expect: "what has vested beyond bob's spending; proven",
    got: `budget ${carolBudget}, carol +${carolGot}`,
    pass: w2.req.ok && s3.proven && carolGot === carolBudget,
    links: [...w2.links, ...settleLinks(s3.steps)],
  });

  const w3 = await withdrawTo(carol, id, carolEvm, {
    amount: await leaseLeft(contract, id),
  });
  const carolRetained = raw(w3.req);
  run.record({
    step: "carol keeps a signed transfer",
    expect: "a valid transfer(to=carol) within the budget, never broadcast",
    got: carolRetained
      ? "signed and kept"
      : w3.req.ok
        ? "no raw"
        : w3.req.error,
    pass: !!carolRetained,
    links: w3.links,
  });

  await Bun.sleep(Math.max(0, endsAt - Date.now()) + 10_000);
  const s4 = await settle(contract, keeper, id);
  const ended = await lotOf(id);
  const gone = await view(contract, "nft_token", { token_id: leaseToken });
  run.record({
    step: "keeper settles the run-out lease",
    expect:
      "anyone seals; the burn is proven; the lease token is gone and alice controls the lot",
    got: `${ended.state}, lease ${JSON.stringify(ended.lease)}, ${leaseToken} ${gone ? "still exists" : "burned"}`,
    pass:
      s4.steps.some((x) => x.kind === "seal" && x.outcome.ok) &&
      s4.proven &&
      ended.state === "Clean" &&
      !ended.lease &&
      !gone &&
      ended.owner === alice,
    links: settleLinks(s4.steps),
  });

  const carolHeist = carolRetained ? await base.broadcast(carolRetained) : null;
  run.record({
    step: "carol broadcasts her kept transfer",
    expect: "Base rejects it: its nonce was consumed",
    got: firstLine(carolHeist),
    pass: carolHeist?.status === "nonce-too-low",
  });

  const u = await call(alice, contract, "unseal", { id }, { deposit: YOCTO });
  const aliceTokensBefore = await base.tokenBalance(p.token, aliceEvm);
  const w4 = await withdrawTo(alice, id, aliceEvm);
  const s5 = await settle(contract, keeper, id);
  const aliceTokens = await base.tokenBalance(p.token, aliceEvm);
  run.record({
    step: "alice withdraws",
    expect: "control is back with the owner, with no lease budget",
    got: `alice ${aliceTokensBefore} -> ${aliceTokens}`,
    pass: u.ok && w4.req.ok && s5.proven && aliceTokens > aliceTokensBefore,
    links: [u.url, ...w4.links, ...settleLinks(s5.steps)],
  });
}
