/**
 * Leases: Alice leases her Clean lot to Bob. Alice is locked out; Bob moves out only what the stream
 * vests during the lease, keeps a signed transfer, seals, and resells the lease to Carol, and Base
 * rejects his kept transfer. At expiry the keeper seals and proves, the lease token burns, Carol's
 * kept transfer is rejected, and Alice withdraws again.
 */
import { nearToYocto } from "near-api-js";
import * as base from "../base.ts";
import { settle } from "../keeper.ts";
import { buy, leaseLeft, list, offerLease, provision, requestTransfer, seal, takeLease } from "../lot.ts";
import { call, getFinality, view } from "../near.ts";
import { alice, aliceEvm, bob, bobEvm, carol, carolEvm, contract, keeper, lotOf, minter, raw, transferTitle, withdrawTo } from "./context.ts";
import { firstLine, settleLinks, type Run } from "./report.ts";

const PRICE = nearToYocto("0.1");
const ROYALTY_BPS = 250;
const royalty = (PRICE * BigInt(ROYALTY_BPS)) / 10_000n;
const proceeds = async (account: string) => BigInt(await view(contract, "proceeds_of", { account_id: account }));

export async function lease(run: Run) {
  const p = await provision({ contract, name: `e2e-lease-${run.started.getTime()}`, owner: alice, minter, royaltyBps: ROYALTY_BPS });
  run.lots.push({ id: p.id, address: p.address });
  run.record("provision", "fresh lot with a clean Sablier stream", `lot ${p.id} at ${p.address}, stream ${p.streamId}`, p.title.clean, [p.mint.url]);
  const id = p.id;
  const leaseToken = `${id}-lease`;

  const s0 = await seal(contract, alice, id);
  const clean = await lotOf(id);
  run.record("alice seals", "nothing outstanding: Clean at once", `${clean.state} v${clean.version}`, s0.ok && clean.state === "Clean", [s0.url]);

  // The term must outlast three proofs at the contract's finality: Bob's withdrawal, his seal, Carol's withdrawal.
  const term = (await getFinality(contract)) === "Latest" ? 5 * 60_000 : 40 * 60_000;
  const endsAt = Date.now() + term;
  const offer = await offerLease(contract, alice, id, PRICE, endsAt);
  const offered = await lotOf(id);
  run.record("alice offers a lease", `a ${term / 60_000}-minute lease, bound to the current version`,
    `ends ${new Date(endsAt).toISOString()}, price ${offered.lease_offer?.price}, version ${offered.lease_offer?.version}`,
    offer.ok && offered.lease_offer?.version === offered.version, [offer.url]);

  const [aliceBefore, minterBefore] = [await proceeds(alice), await proceeds(minter)];
  const take = await takeLease(contract, bob, id);
  const taken = await lotOf(id);
  const token = await view(contract, "nft_token", { token_id: leaseToken });
  const [aliceGot, minterGot] = [(await proceeds(alice)) - aliceBefore, (await proceeds(minter)) - minterBefore];
  run.record("bob takes the lease", "the lease token is bob's, the lot is Active for him, alice and the minter (2.5%) are credited",
    `${token?.token_id} owned by ${token?.owner_id}; ${taken.state} v${taken.version}; alice +${aliceGot}, minter +${minterGot}`,
    take.ok && taken.lease?.holder === bob && token?.owner_id === bob && taken.state === "Active" && aliceGot === PRICE - royalty && minterGot === royalty,
    [take.url]);

  const ownerRequest = await requestTransfer(contract, alice, id, aliceEvm, { amount: 1n, gasLimit: 80_000 });
  run.record("alice requests during the lease", "refused: the lease holder controls the lot", ownerRequest.ok ? "signed!" : ownerRequest.error,
    !ownerRequest.ok && ownerRequest.error.includes("not the lot controller"), [ownerRequest.url]);

  const bobBefore = await base.tokenBalance(p.token, bobEvm);
  const budget = await leaseLeft(contract, id);
  const w0 = await withdrawTo(bob, id, bobEvm, { amount: budget });
  const s1 = await settle(contract, keeper, id);
  const bobGot = (await base.tokenBalance(p.token, bobEvm)) - bobBefore;
  run.record("bob withdraws within the budget", "everything vested since the lease began; proven, still Active",
    `budget ${budget}, bob +${bobGot}, ${s1.lot.state}`, w0.req.ok && s1.proven && bobGot === budget && s1.lot.state === "Active",
    [...w0.links, ...settleLinks(s1.steps)]);

  const over = await requestTransfer(contract, bob, id, bobEvm, { amount: (await leaseLeft(contract, id)) + 10n ** 24n, gasLimit: 80_000 });
  run.record("bob requests over the budget", "refused: more than the stream has vested during the lease", over.ok ? "signed!" : over.error,
    !over.ok && over.error.includes("over the lease budget"), [over.url]);

  const w1 = await withdrawTo(bob, id, bobEvm, { amount: await leaseLeft(contract, id) });
  const bobRetained = raw(w1.req);
  run.record("bob keeps a signed transfer", "a valid transfer(to=bob) within the budget, never broadcast", bobRetained ? "signed and kept" : w1.req.ok ? "no raw" : w1.req.error,
    !!bobRetained, w1.links);

  const bs = await seal(contract, bob, id);
  const s2 = await settle(contract, keeper, id);
  run.record("bob seals and the burn is proven", "Clean, and bob still holds the lease", `${s2.lot.state}, lease holder ${s2.lot.lease?.holder}`,
    bs.ok && s2.lot.state === "Clean" && s2.lot.lease?.holder === bob, [bs.url, ...settleLinks(s2.steps)]);

  const titleMove = await transferTitle(alice, id, carol);
  run.record("alice transfers the title during the lease", "refused, even while Clean", titleMove.ok ? "moved!" : titleMove.error,
    !titleMove.ok && titleMove.error.includes("the title can't move during a lease"), [titleMove.url]);

  const l = await list(contract, bob, id, PRICE);
  const listed = await lotOf(id);
  run.record("bob lists the lease", "the listing is for the lease, bound to the current version", `${listed.listing?.item} at ${listed.listing?.price}, version ${listed.listing?.version}`,
    l.ok && listed.listing?.item === "Lease" && listed.listing.version === listed.version, [l.url]);

  const [sellerBefore, minterBeforeResale] = [await proceeds(bob), await proceeds(minter)];
  const committed = listed.lease?.committed;
  const sale = await buy(contract, carol, id);
  const resold = await lotOf(id);
  const [sellerGot, minterGotAgain] = [(await proceeds(bob)) - sellerBefore, (await proceeds(minter)) - minterBeforeResale];
  run.record("carol buys the lease", "carol holds the lease with bob's spent budget; alice keeps the title; bob and the minter are credited",
    `holder ${resold.lease?.holder}, owner ${resold.owner}, committed ${resold.lease?.committed}; bob +${sellerGot}, minter +${minterGotAgain}`,
    sale.ok && resold.lease?.holder === carol && resold.owner === alice && resold.lease.committed === committed && sellerGot === PRICE - royalty && minterGotAgain === royalty,
    [sale.url]);

  const bobHeist = bobRetained ? await base.broadcast(bobRetained) : null;
  run.record("bob broadcasts his kept transfer", "Base rejects it: its nonce was consumed", firstLine(bobHeist), bobHeist?.status === "nonce-too-low");

  const carolBefore = await base.tokenBalance(p.token, carolEvm);
  const carolBudget = await leaseLeft(contract, id);
  const w2 = await withdrawTo(carol, id, carolEvm, { amount: carolBudget });
  const s3 = await settle(contract, keeper, id);
  const carolGot = (await base.tokenBalance(p.token, carolEvm)) - carolBefore;
  run.record("carol withdraws within the budget", "what has vested beyond bob's spending; proven", `budget ${carolBudget}, carol +${carolGot}`,
    w2.req.ok && s3.proven && carolGot === carolBudget, [...w2.links, ...settleLinks(s3.steps)]);

  const w3 = await withdrawTo(carol, id, carolEvm, { amount: await leaseLeft(contract, id) });
  const carolRetained = raw(w3.req);
  run.record("carol keeps a signed transfer", "a valid transfer(to=carol) within the budget, never broadcast", carolRetained ? "signed and kept" : w3.req.ok ? "no raw" : w3.req.error,
    !!carolRetained, w3.links);

  await Bun.sleep(Math.max(0, endsAt - Date.now()) + 10_000);
  const s4 = await settle(contract, keeper, id);
  const ended = await lotOf(id);
  const gone = await view(contract, "nft_token", { token_id: leaseToken });
  run.record("keeper settles the run-out lease", "anyone seals; the burn is proven; the lease token is gone and alice controls the lot",
    `${ended.state}, lease ${JSON.stringify(ended.lease)}, ${leaseToken} ${gone ? "still exists" : "burned"}`,
    s4.steps.some((x) => x.kind === "seal" && x.outcome.ok) && s4.proven && ended.state === "Clean" && !ended.lease && !gone && ended.owner === alice,
    settleLinks(s4.steps));

  const carolHeist = carolRetained ? await base.broadcast(carolRetained) : null;
  run.record("carol broadcasts her kept transfer", "Base rejects it: its nonce was consumed", firstLine(carolHeist), carolHeist?.status === "nonce-too-low");

  const u = await call(alice, contract, "unseal", { id });
  const aliceTokensBefore = await base.tokenBalance(p.token, aliceEvm);
  const w4 = await withdrawTo(alice, id, aliceEvm);
  const s5 = await settle(contract, keeper, id);
  const aliceTokens = await base.tokenBalance(p.token, aliceEvm);
  run.record("alice withdraws", "control is back with the owner, with no lease budget", `alice ${aliceTokensBefore} -> ${aliceTokens}`,
    u.ok && w4.req.ok && s5.proven && aliceTokens > aliceTokensBefore, [u.url, ...w4.links, ...settleLinks(s5.steps)]);
}
