/**
 * Recovery: the seller broadcasts first and the burn replaces it; a stalled burn stays repriceable
 * after a rescue; a transfer that mines but reverts is recovered by the keeper's rescue burn; a
 * direct title transfer pays no royalty.
 */
import type { Hex } from "viem";
import { isBurn } from "@quitclaim/shared";
import * as base from "../base.ts";
import { settle } from "../keeper.ts";
import { provision, rebump, requestTransfer, rescue, seal } from "../lot.ts";
import { call, view } from "../near.ts";
import { alice, aliceEvm, bob, contract, keeper, lotOf, raw, transferTitle, withdrawTo } from "./context.ts";
import { firstLine, settleLinks, type Run } from "./report.ts";

export async function recovery(run: Run) {
  const p = await provision({ contract, name: `e2e-recovery-${run.started.getTime()}`, owner: alice, issuer: alice });
  run.lots.push({ id: p.id, address: p.address });
  run.record("provision", "fresh lot with a clean Sablier stream", `lot ${p.id} at ${p.address}, stream ${p.streamId}`, p.title.clean, [p.mint.url]);
  const id = p.id;

  const low = await withdrawTo(alice, id, aliceEvm, { fees: { max_fee: "1000000", max_prio: "1000000" } });
  const lowRaw = raw(low.req);
  const sent = lowRaw ? await base.broadcast(lowRaw) : null;
  const lowHash = sent && "hash" in sent ? sent.hash : null;
  run.record("alice broadcasts first", "her withdrawal is in the pool but priced below the base fee, so it can't mine yet",
    sent ? sent.status : low.req.ok ? "no raw" : low.req.error, sent?.status === "sent" || sent?.status === "known",
    [...low.links, ...(lowHash ? [`pending ${base.txUrl(lowHash)}`] : [])]);

  const s = await seal(contract, alice, id, { max_fee: "1100000", max_prio: "1100000" });
  const stalled = (await lotOf(id)).issued.find(isBurn);
  const stalledBroadcast = stalled?.raw_tx ? await base.broadcast(stalled.raw_tx as Hex) : null;
  const earlyRescue = await rescue(contract, bob, id);
  const bumped = await rebump(contract, bob, id, 0);
  run.record("rebump the stuck burn after a rescue", "the burn at nonce 0 stays repriceable with a rescue at nonce 1",
    `stalled broadcast=${stalledBroadcast?.status}; rescue=${earlyRescue.ok}; rebump=${bumped.ok}`,
    s.ok && (stalledBroadcast?.status === "sent" || stalledBroadcast?.status === "known") && earlyRescue.ok && bumped.ok,
    [s.url, earlyRescue.url, bumped.url]);

  const r = await settle(contract, keeper, id);
  const gone = lowHash ? (await base.receipt(lowHash)) === null : false;
  const again = lowRaw ? await base.broadcast(lowRaw) : null;
  run.record("burn replaces the pending withdrawal", "burn mines at her nonce, her tx never mines, rebroadcast is rejected",
    `${r.lot.state}; alice's tx mined=${!gone}; rebroadcast: ${firstLine(again)}`,
    r.lot.state === "Clean" && gone && again?.status === "nonce-too-low", settleLinks(r.steps));

  const u = await call(alice, contract, "unseal", { id });
  const held = await base.tokenBalance(p.token, p.address);
  const bad = await requestTransfer(contract, alice, id, aliceEvm, { amount: held + 10n ** 30n, gasLimit: 80_000 });
  const rv = await settle(contract, keeper, id);
  run.record("transfer mines but reverts", "more than the lot holds: the tx consumes the nonce but can never be proven",
    `reverted=${rv.reverted}, proven=${rv.proven}, next_nonce ${rv.lot.next_nonce}`, rv.reverted && !rv.proven, [u.url, bad.url, ...settleLinks(rv.steps)]);

  const s2 = await seal(contract, alice, id);
  const rr = await settle(contract, keeper, id);
  run.record("keeper rescues the reverted nonce", "the keeper signs a burn at the next nonce; proving it proves the stuck one: Clean",
    `${rr.lot.state} v${rr.lot.version}, next_nonce ${rr.lot.next_nonce}`, rr.lot.state === "Clean" && rr.lot.next_nonce === rv.lot.next_nonce + 2 && rr.steps.some((x) => x.kind === "rescue"),
    [s2.url, ...settleLinks(rr.steps)]);

  const proceedsBefore = await view(contract, "proceeds_of", { account_id: alice });
  const t = await transferTitle(alice, id);
  const moved = await lotOf(id);
  const proceedsAfter = await view(contract, "proceeds_of", { account_id: alice });
  run.record("direct transfer", "nft_transfer from Clean moves the title and pays no royalty",
    `${moved.owner} ${moved.state}; issuer proceeds ${proceedsBefore} -> ${proceedsAfter}`, t.ok && moved.owner === bob && proceedsBefore === proceedsAfter, [t.url]);
}
