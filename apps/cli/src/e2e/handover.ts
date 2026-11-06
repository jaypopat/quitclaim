/**
 * The handover: Alice withdraws, keeps a signed withdrawal, seals; the burn is proven; her retained
 * withdrawal is rejected by Base; an outsider pulls the stream while the lot is listed; Bob buys with
 * a minter royalty; payouts are pulled; Alice is locked out; Bob withdraws to himself, then resells
 * to Carol: three owners, one address.
 */
import { config, isBurn } from "@quitclaim/shared";
import * as base from "@quitclaim/sdk/base.ts";
import { retainedTx } from "../heist-evidence.ts";
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

export async function handover(run: Run) {
  const p = await provision({
    contract,
    name: `e2e-handover-${run.started.getTime()}`,
    owner: alice,
    minter,
    royaltyBps: ROYALTY_BPS,
  });
  run.lots.push({ id: p.id, address: p.address });
  run.record(
    "provision",
    "Sablier stream pays the lot; title search clean; contract learns the address from MPC",
    `lot ${p.id} at ${p.address}, stream ${p.streamId}, ${JSON.stringify(p.title)}`,
    p.title.clean,
    [
      p.mint.url,
      `stream ${base.txUrl(p.streamTx)}`,
      `gas ${base.txUrl(p.fundTx)}`,
    ],
  );
  const id = p.id;

  const w0 = await withdrawTo(alice, id, aliceEvm);
  run.record(
    "alice withdraws",
    "stream pulled into the lot; contract-built transfer(to=alice) signed",
    w0.req.ok ? "signed" : w0.req.error,
    w0.req.ok && !!w0.req.value,
    w0.links,
  );
  const s0 = await settle(contract, keeper, id);
  const aliceTokens = await base.tokenBalance(p.token, aliceEvm);
  run.record(
    "prove withdrawal",
    "nonce 0 proven consumed, lot stays Active",
    `${s0.lot.state}, next_nonce ${s0.lot.next_nonce}, alice holds ${aliceTokens}`,
    s0.lot.state === "Active" && s0.lot.next_nonce === 1 && aliceTokens > 0n,
    settleLinks(s0.steps),
  );

  const w1 = await withdrawTo(alice, id, aliceEvm);
  const retained = raw(w1.req);
  run.record(
    "alice retains a withdrawal",
    "a valid signed transfer(to=alice) at nonce 1, never broadcast",
    retained ? "signed and kept" : w1.req.ok ? "no raw" : w1.req.error,
    !!retained,
    w1.links,
  );
  if (retained) await run.describeRetained(retained);

  const early = await transferTitle(alice, id);
  run.record(
    "transfer with an outstanding signed request",
    "refused: an unproven nonce means the lot is not Clean",
    early.ok ? "accepted!" : early.error,
    !early.ok && early.error.includes("not Clean"),
    [early.url],
  );

  const s = await seal(contract, alice, id);
  const sealed = await lotOf(id);
  run.record(
    "alice seals",
    "Sealing, burn signed at nonce 1 with both fees bumped",
    `${sealed.state}, issued ${sealed.issued.map((i) => (isBurn(i) ? "burn" : "transfer")).join("+")}`,
    s.ok && sealed.state === "Sealing" && sealed.issued.some(isBurn),
    [s.url],
  );

  const refused = await requestTransfer(contract, alice, id, aliceEvm, {
    amount: 1n,
    gasLimit: 80_000,
  });
  run.record(
    "alice requests while Sealing",
    "refused: lot is not Active",
    refused.ok ? "signed!" : refused.error,
    !refused.ok && refused.error.includes("not Active"),
    [refused.url],
  );

  const tooSoon = await list(contract, alice, id, PRICE);
  run.record(
    "alice lists while Sealing",
    "refused: agreements only while Clean",
    tooSoon.ok ? "listed!" : tooSoon.error,
    !tooSoon.ok && tooSoon.error.includes("not Clean"),
    [tooSoon.url],
  );

  const s1 = await settle(contract, keeper, id);
  run.record(
    "prove burn",
    "old nonce proven consumed: Clean",
    `${s1.lot.state} v${s1.lot.version}, next_nonce ${s1.lot.next_nonce}`,
    s1.lot.state === "Clean" && s1.lot.next_nonce === 2,
    settleLinks(s1.steps),
  );

  const heist = retained ? await base.broadcast(retained) : null;
  run.record(
    "alice broadcasts the retained withdrawal",
    "Base rejects it: its nonce was consumed",
    firstLine(heist),
    heist?.status === "nonce-too-low",
  );

  const sellerBefore = await proceeds(alice);
  const minterBefore = await proceeds(minter);
  const l = await list(contract, alice, id, PRICE);
  const listed = await lotOf(id);
  run.record(
    "alice lists the Clean lot",
    "listing bound to the current version",
    `price ${listed.listing?.price}, version ${listed.listing?.version}`,
    l.ok && listed.listing?.version === listed.version,
    [l.url],
  );

  const before = await position(listed);
  const outsider = await pullSource(listed);
  const after = await position(listed);
  const stillListed = await lotOf(id);
  run.record(
    "outsider pulls the stream while listed",
    "value moves from the stream into the lot; the total never drops; the listing stands",
    `locked ${before.locked} -> ${after.locked}, held ${before.held} -> ${after.held}, total ${before.total} -> ${after.total}`,
    after.total === before.total &&
      after.held >= before.held &&
      stillListed.listing?.version === stillListed.version,
    outsider ? [`pull ${base.txUrl(outsider)}`] : [],
  );

  const sale = await buy(contract, bob, id);
  const moved = await lotOf(id);
  const sellerGot = (await proceeds(alice)) - sellerBefore;
  const minterGot = (await proceeds(minter)) - minterBefore;
  run.record(
    "bob buys",
    "one call moves the title and credits seller and minter (2.5% royalty)",
    `${moved.owner} ${moved.state} v${moved.version}; seller +${sellerGot}, minter +${minterGot}`,
    sale.ok &&
      moved.owner === bob &&
      moved.state === "Active" &&
      sellerGot === PRICE - royalty &&
      minterGot === royalty,
    [sale.url],
  );

  const ws = await withdraw(contract, alice);
  const wi = await withdraw(contract, minter);
  run.record(
    "seller and minter withdraw",
    "pulled payouts transfer and zero the balances",
    `seller ${ws.ok ? ws.value : ws.error}, minter ${wi.ok ? wi.value : wi.error}`,
    ws.ok &&
      ws.value === true &&
      wi.ok &&
      wi.value === true &&
      (await proceeds(alice)) === 0n,
    [ws.url, wi.url],
  );

  const locked = await requestTransfer(contract, alice, id, aliceEvm, {
    amount: 1n,
    gasLimit: 80_000,
  });
  run.record(
    "alice requests after the sale",
    "refused: not the lot controller",
    locked.ok ? "signed!" : locked.error,
    !locked.ok && locked.error.includes("not the lot controller"),
    [locked.url],
  );

  const aliceBefore = await base.tokenBalance(p.token, aliceEvm);
  const wb = await withdrawTo(bob, id, bobEvm);
  const sb = await settle(contract, keeper, id);
  const bobTokens = await base.tokenBalance(p.token, bobEvm);
  const aliceAfter = await base.tokenBalance(p.token, aliceEvm);
  const title = await sablier.titleSearch(p.streamId, p.address, p.token);
  run.record(
    "bob withdraws",
    "bob's withdrawal pays bob; alice's balance unchanged; the stream still pays the same address",
    `bob holds ${bobTokens}, alice ${aliceBefore} -> ${aliceAfter}, title clean=${title.clean}`,
    wb.req.ok && bobTokens > 0n && aliceBefore === aliceAfter && title.clean,
    [...wb.links, ...settleLinks(sb.steps)],
  );

  const minterBeforeResale = await proceeds(minter);
  const bs = await seal(contract, bob, id);
  const bobLot = await lotOf(id);
  const bl = await list(contract, bob, id, PRICE);
  const resale = await buy(contract, carol, id);
  const third = await lotOf(id);
  const minterGotAgain = (await proceeds(minter)) - minterBeforeResale;
  const resold = await sablier.titleSearch(p.streamId, p.address, p.token);
  run.record(
    "bob resells to carol",
    "Bob's lot has nothing outstanding, so sealing is Clean at once; Carol buys; three owners, one address; the minter earns again",
    `sealed ${bobLot.state}; owner ${third.owner} v${third.version}; address ${third.address}; minter +${minterGotAgain}; title clean=${resold.clean}`,
    bs.ok &&
      bobLot.state === "Clean" &&
      bl.ok &&
      resale.ok &&
      third.owner === carol &&
      third.address === p.address.toLowerCase() &&
      minterGotAgain === royalty &&
      resold.clean,
    [bs.url, bl.url, resale.url],
  );

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
  run.record(
    "heist evidence captured",
    "retained withdrawal, proven burn, sale and buyer withdrawal available",
    run.heist ? "complete" : "missing evidence",
    !!run.heist,
  );
}
