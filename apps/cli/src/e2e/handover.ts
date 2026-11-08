/**
 * The handover: Alice withdraws, keeps a signed withdrawal, seals; the burn is proven; her retained
 * withdrawal is rejected by Base; an outsider pulls the stream while the lot is listed; Bob buys with
 * a minter royalty; payouts are pulled; Alice is locked out; Bob withdraws to himself, then resells
 * to Carol: three owners, one address.
 */
import { config, isBurn } from "@quitclaim/shared";
import * as base from "@quitclaim/sdk/base.ts";
import { retainedTx } from "@quitclaim/shared/heist/evidence.ts";
import { provenMined, settle } from "@quitclaim/sdk/settle.ts";
import {
  buy,
  list,
  position,
  provision,
  pullSource,
  requestTransfer,
  seal,
  withdraw,
} from "@quitclaim/sdk/lot.ts";
import * as sablier from "@quitclaim/sdk/sablier.ts";
import {
  alice,
  aliceEvm,
  bob,
  bobEvm,
  carol,
  contract,
  minter,
  keeper,
  lotOf,
  PRICE,
  proceeds,
  raw,
  royalty,
  ROYALTY_BPS,
  transferTitle,
  withdrawTo,
} from "./context.ts";
import { firstLine, settleLinks, type Run } from "./report.ts";
import { baseTxUrl, tokenBalance } from "@quitclaim/shared/base.ts";
import { titleSearch } from "@quitclaim/shared/sablier.ts";

export async function handover(run: Run) {
  const p = await provision({
    contract,
    name: `e2e-handover-${run.started.getTime()}`,
    owner: alice,
    minter,
    royaltyBps: ROYALTY_BPS,
  });
  run.lots.push({ id: p.id, address: p.address });
  run.record({
    step: "provision",
    expect:
      "Sablier stream pays the lot; title search clean; contract learns the address from MPC",
    got: `lot ${p.id} at ${p.address}, stream ${p.streamId}, ${JSON.stringify(p.title)}`,
    pass: p.title.clean,
    links: [
      p.mint.url,
      `stream ${baseTxUrl(p.streamTx)}`,
      `gas ${baseTxUrl(p.fundTx)}`,
    ],
  });
  const id = p.id;

  const w0 = await withdrawTo(alice, id, aliceEvm);
  run.record({
    step: "alice withdraws",
    expect:
      "stream pulled into the lot; contract-built transfer(to=alice) signed",
    got: w0.req.ok ? "signed" : w0.req.error,
    pass: w0.req.ok && !!w0.req.value,
    links: w0.links,
  });
  const s0 = await settle(contract, keeper, id);
  const aliceTokens = await tokenBalance(p.token, aliceEvm);
  run.record({
    step: "prove withdrawal",
    expect: "nonce 0 proven consumed, lot stays Active",
    got: `${s0.lot.state}, next_nonce ${s0.lot.next_nonce}, alice holds ${aliceTokens}`,
    pass:
      s0.lot.state === "Active" && s0.lot.next_nonce === 1 && aliceTokens > 0n,
    links: settleLinks(s0.steps),
  });

  const w1 = await withdrawTo(alice, id, aliceEvm);
  const retained = raw(w1.req);
  run.record({
    step: "alice retains a withdrawal",
    expect: "a valid signed transfer(to=alice) at nonce 1, never broadcast",
    got: retained ? "signed and kept" : w1.req.ok ? "no raw" : w1.req.error,
    pass: !!retained,
    links: w1.links,
  });
  if (retained) await run.describeRetained(retained);

  const early = await transferTitle(alice, id);
  run.record({
    step: "transfer with an outstanding signed request",
    expect: "refused: an unproven nonce means the lot is not Clean",
    got: early.ok ? "accepted!" : early.error,
    pass: !early.ok && early.error.includes("not Clean"),
    links: [early.url],
  });

  const s = await seal(contract, alice, id);
  const sealed = await lotOf(id);
  run.record({
    step: "alice seals",
    expect: "Sealing, burn signed at nonce 1 with both fees bumped",
    got: `${sealed.state}, issued ${sealed.issued.map((i) => (isBurn(i) ? "burn" : "transfer")).join("+")}`,
    pass: s.ok && sealed.state === "Sealing" && sealed.issued.some(isBurn),
    links: [s.url],
  });

  const refused = await requestTransfer(contract, alice, id, aliceEvm, {
    amount: 1n,
    gasLimit: 80_000,
  });
  run.record({
    step: "alice requests while Sealing",
    expect: "refused: lot is not Active",
    got: refused.ok ? "signed!" : refused.error,
    pass: !refused.ok && refused.error.includes("not Active"),
    links: [refused.url],
  });

  const tooSoon = await list(contract, alice, id, PRICE);
  run.record({
    step: "alice lists while Sealing",
    expect: "refused: agreements only while Clean",
    got: tooSoon.ok ? "listed!" : tooSoon.error,
    pass: !tooSoon.ok && tooSoon.error.includes("not Clean"),
    links: [tooSoon.url],
  });

  const s1 = await settle(contract, keeper, id);
  run.record({
    step: "prove burn",
    expect: "old nonce proven consumed: Clean",
    got: `${s1.lot.state} v${s1.lot.version}, next_nonce ${s1.lot.next_nonce}`,
    pass: s1.lot.state === "Clean" && s1.lot.next_nonce === 2,
    links: settleLinks(s1.steps),
  });

  const heist = retained ? await base.broadcast(retained) : null;
  run.record({
    step: "alice broadcasts the retained withdrawal",
    expect: "Base rejects it: its nonce was consumed",
    got: firstLine(heist),
    pass: heist?.status === "nonce-too-low",
  });

  const sellerBefore = await proceeds(alice);
  const minterBefore = await proceeds(minter);
  const l = await list(contract, alice, id, PRICE);
  const listed = await lotOf(id);
  run.record({
    step: "alice lists the Clean lot",
    expect: "listing bound to the current version",
    got: `price ${listed.listing?.price}, version ${listed.listing?.version}`,
    pass: l.ok && listed.listing?.version === listed.version,
    links: [l.url],
  });

  const before = await position(listed);
  const outsider = await pullSource(listed);
  const after = await position(listed);
  const stillListed = await lotOf(id);
  run.record({
    step: "outsider pulls the stream while listed",
    expect:
      "value moves from the stream into the lot; the total never drops; the listing stands",
    got: `locked ${before.locked} -> ${after.locked}, held ${before.held} -> ${after.held}, total ${before.total} -> ${after.total}`,
    pass:
      after.total === before.total &&
      after.held >= before.held &&
      stillListed.listing?.version === stillListed.version,
    links: outsider ? [`pull ${baseTxUrl(outsider)}`] : [],
  });

  const sale = await buy(contract, bob, id);
  const moved = await lotOf(id);
  const sellerGot = (await proceeds(alice)) - sellerBefore;
  const minterGot = (await proceeds(minter)) - minterBefore;
  run.record({
    step: "bob buys",
    expect:
      "one call moves the title and credits seller and minter (2.5% royalty)",
    got: `${moved.owner} ${moved.state} v${moved.version}; seller +${sellerGot}, minter +${minterGot}`,
    pass:
      sale.ok &&
      moved.owner === bob &&
      moved.state === "Active" &&
      sellerGot === PRICE - royalty &&
      minterGot === royalty,
    links: [sale.url],
  });

  const ws = await withdraw(contract, alice);
  const wi = await withdraw(contract, minter);
  run.record({
    step: "seller and minter withdraw",
    expect: "pulled payouts transfer and zero the balances",
    got: `seller ${ws.ok ? ws.value : ws.error}, minter ${wi.ok ? wi.value : wi.error}`,
    pass:
      ws.ok &&
      ws.value === true &&
      wi.ok &&
      wi.value === true &&
      (await proceeds(alice)) === 0n,
    links: [ws.url, wi.url],
  });

  const locked = await requestTransfer(contract, alice, id, aliceEvm, {
    amount: 1n,
    gasLimit: 80_000,
  });
  run.record({
    step: "alice requests after the sale",
    expect: "refused: not the lot controller",
    got: locked.ok ? "signed!" : locked.error,
    pass: !locked.ok && locked.error.includes("not the lot controller"),
    links: [locked.url],
  });

  const aliceBefore = await tokenBalance(p.token, aliceEvm);
  const wb = await withdrawTo(bob, id, bobEvm);
  const sb = await settle(contract, keeper, id);
  const bobTokens = await tokenBalance(p.token, bobEvm);
  const aliceAfter = await tokenBalance(p.token, aliceEvm);
  const title = await titleSearch(p.streamId, p.address, p.token);
  run.record({
    step: "bob withdraws",
    expect:
      "bob's withdrawal pays bob; alice's balance unchanged; the stream still pays the same address",
    got: `bob holds ${bobTokens}, alice ${aliceBefore} -> ${aliceAfter}, title clean=${title.clean}`,
    pass:
      wb.req.ok && bobTokens > 0n && aliceBefore === aliceAfter && title.clean,
    links: [...wb.links, ...settleLinks(sb.steps)],
  });

  const minterBeforeResale = await proceeds(minter);
  const bs = await seal(contract, bob, id);
  const bobLot = await lotOf(id);
  const bl = await list(contract, bob, id, PRICE);
  const resale = await buy(contract, carol, id);
  const third = await lotOf(id);
  const minterGotAgain = (await proceeds(minter)) - minterBeforeResale;
  const resold = await titleSearch(p.streamId, p.address, p.token);
  run.record({
    step: "bob resells to carol",
    expect:
      "Bob's lot has nothing outstanding, so sealing is Clean at once; Carol buys; three owners, one address; the minter earns again",
    got: `sealed ${bobLot.state}; owner ${third.owner} v${third.version}; address ${third.address}; minter +${minterGotAgain}; title clean=${resold.clean}`,
    pass:
      bs.ok &&
      bobLot.state === "Clean" &&
      bl.ok &&
      resale.ok &&
      third.owner === carol &&
      third.address === p.address.toLowerCase() &&
      minterGotAgain === royalty &&
      resold.clean,
    links: [bs.url, bl.url, resale.url],
  });

  const consumed = provenMined(s1.steps);
  const paid = provenMined(sb.steps);
  if (retained && consumed && paid && sale.ok) {
    run.heist = {
      chainId: config.evm.chainId,
      contract,
      lot: { id, address: p.address, token: p.token },
      seller: { near: alice, evm: aliceEvm },
      buyer: { near: bob, evm: bobEvm },
      retained: retainedTx.parse(retained),
      consumingTx: consumed.mined.tx,
      proof: { hash: consumed.proof.outcome.tx, signer: keeper },
      sale: { hash: sale.tx, signer: bob },
      buyerWithdrawal: paid.mined.tx,
    };
  }
  run.record({
    step: "heist evidence captured",
    expect:
      "retained withdrawal, proven burn, sale and buyer withdrawal available",
    got: run.heist ? "complete" : "missing evidence",
    pass: !!run.heist,
  });
}
