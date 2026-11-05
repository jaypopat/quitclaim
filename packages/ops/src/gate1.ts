/**
 * Gate 1: adversarial handover on fresh lots. Every step asserts what the security model promises,
 * and the run writes a report with every NEAR and Base link.
 *
 *   bun run gate1
 *
 * Lot A is the handover: claim, a retained claim, seal, proof, the heist, transfer, new owner claims.
 * Lot B covers the paths lot A can't: the seller broadcasts first and the burn replaces it, and a
 * claim that mines but reverts, recovered by a rescue burn at the next nonce.
 */
import { parseTransaction, recoverTransactionAddress, type Address, type Hex } from "viem";
import { isBurn, type Lot } from "@quitclaim/shared";
import * as base from "./base.ts";
import { call, codeHash, getFinality, getLot } from "./near.ts";
import { env } from "./env.ts";
import { provision, rebump, relay, requestClaim, rescue, seal, type RelayStep } from "./lot.ts";

const contract = env.lotContract();
const alice = process.env.ALICE_ACCOUNT ?? env.admin();
const bob = process.env.BOB_ACCOUNT ?? `bob.${env.admin()}`;
const aliceEvm: Address = "0x000000000000000000000000000000000000a11c";
const bobEvm: Address = "0x0000000000000000000000000000000000000b0b";

type Row = { step: string; expect: string; got: string; links: string[]; pass: boolean };
const rows: Row[] = [];
const notes: string[] = [];
const started = new Date();

function record(step: string, expect: string, got: string, pass: boolean, links: string[] = []) {
  rows.push({ step, expect, got, links, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${step}: ${got}`);
  for (const l of links) console.log(`      ${l}`);
}

function relayLinks(steps: RelayStep[]) {
  return steps.flatMap((s) => {
    if (s.kind === "topup") return [`top-up ${base.txUrl(s.tx)}`];
    if (s.kind === "broadcast" && "hash" in s.result) return [`broadcast ${base.txUrl(s.result.hash)}`];
    if (s.kind === "mined") return [`mined (${s.status}) block ${s.block} ${base.txUrl(s.tx)}`];
    if (s.kind === "prove") return [`prove ${s.outcome.url}`];
    return [];
  });
}

const lotOf = async (id: number): Promise<Lot> => {
  const lot = await getLot(contract, id);
  if (!lot) throw new Error(`lot ${id} missing`);
  return lot;
};

const transfer = (from: string, id: number) =>
  call(from, contract, "nft_transfer", { receiver_id: bob, token_id: String(id) }, { deposit: 1n });

async function describeRetained(raw: Hex) {
  const tx = parseTransaction(raw);
  const from = await recoverTransactionAddress({ serializedTransaction: raw as never });
  notes.push(
    "## Retained transaction (the heist)",
    "",
    "Signed by MPC for the lot before the seal and never broadcast by the contract. Rebroadcast it yourself; Base rejects it because its nonce is consumed.",
    "",
    `- recovered sender: \`${from}\``,
    `- chain id: ${tx.chainId}, nonce: ${tx.nonce}, to: \`${tx.to}\``,
    `- calldata: \`${tx.data}\` (claim(to=alice))`,
    "",
    "```",
    raw,
    "```",
    "",
  );
}

async function lotA() {
  const p = await provision({ contract, path: `gate1-a-${started.getTime()}`, owner: alice, issuer: alice });
  record("A: provision", "contract learns the derived address from MPC", `lot ${p.id} at ${p.address}`, true, [
    p.mint.url,
    `vesting ${base.txUrl(p.vestingTx)}`,
    `gas ${base.txUrl(p.fundTx)}`,
  ]);
  const id = p.id;

  const c0 = await requestClaim(contract, alice, id, aliceEvm);
  record("A: alice claim 0", "contract-built claim(to=alice) signed", c0.ok ? "signed" : c0.error, c0.ok && !!c0.value, [c0.url]);
  const r0 = await relay(contract, bob, id, () => true);
  const aliceTokens = await base.tokenBalance(p.vesting, aliceEvm);
  record("A: prove claim 0", "nonce 0 proven consumed, lot stays Active", `${r0.lot.state}, next_nonce ${r0.lot.next_nonce}, alice holds ${aliceTokens}`,
    r0.lot.state === "Active" && r0.lot.next_nonce === 1 && aliceTokens > 0n, relayLinks(r0.steps));

  const pendingSign = requestClaim(contract, alice, id, aliceEvm);
  await Bun.sleep(4_000);
  const signingBefore = (await lotOf(id)).sign_in_flight;
  const t1 = await transfer(alice, id);
  const signingAfter = (await lotOf(id)).sign_in_flight;
  record("A: transfer while a sign is in flight", "refused while MPC is still signing",
    `sign_in_flight before=${signingBefore} after=${signingAfter}; transfer: ${t1.ok ? "accepted!" : t1.error}`,
    signingBefore && signingAfter && !t1.ok && t1.error.includes("not Clean"), [t1.url]);

  const c1 = await pendingSign;
  const retained = c1.ok ? (c1.value as Hex | null) : null;
  record("A: alice retains claim 1", "a valid signed claim(to=alice) at nonce 1, never broadcast", retained ? "signed and kept" : c1.ok ? "no raw" : c1.error, !!retained, [c1.url]);
  if (retained) await describeRetained(retained);

  const s = await seal(contract, alice, id);
  const sealed = await lotOf(id);
  record("A: alice seals", "Sealing, burn signed at nonce 1 with both fees bumped", `${sealed.state}, issued ${sealed.issued.map((i) => (isBurn(i) ? "burn" : "claim")).join("+")}`,
    s.ok && sealed.state === "Sealing" && sealed.issued.some(isBurn), [s.url]);

  const refused = await requestClaim(contract, alice, id, aliceEvm);
  record("A: alice requests while Sealing", "refused: lot is not Active", refused.ok ? "signed!" : refused.error, !refused.ok && refused.error.includes("not Active"), [refused.url]);

  const r1 = await relay(contract, bob, id, isBurn);
  record("A: prove burn", "old nonce proven consumed: Clean", `${r1.lot.state} v${r1.lot.version}, next_nonce ${r1.lot.next_nonce}`, r1.lot.state === "Clean" && r1.lot.next_nonce === 2, relayLinks(r1.steps));

  const heist = retained ? await base.broadcast(retained) : null;
  record("A: alice broadcasts the retained claim", "Base rejects it: its nonce was consumed", heist ? ("message" in heist ? heist.message.split("\n")[0]! : `accepted ${heist.hash}`) : "no retained tx",
    heist?.status === "nonce-too-low");

  const t = await transfer(alice, id);
  const moved = await lotOf(id);
  record("A: transfer to bob", "title moves only from Clean; lot Active for bob", `${moved.owner} ${moved.state} v${moved.version}`, t.ok && moved.owner === bob && moved.state === "Active", [t.url]);

  const locked = await requestClaim(contract, alice, id, aliceEvm);
  record("A: alice requests after transfer", "refused: not the lot owner", locked.ok ? "signed!" : locked.error, !locked.ok && locked.error.includes("not the lot owner"), [locked.url]);

  const before = await base.tokenBalance(p.vesting, aliceEvm);
  const b = await requestClaim(contract, bob, id, bobEvm);
  const rb = await relay(contract, bob, id, () => true);
  const bobTokens = await base.tokenBalance(p.vesting, bobEvm);
  const after = await base.tokenBalance(p.vesting, aliceEvm);
  record("A: bob claims", "bob's claim pays bob; alice's balance unchanged", `bob holds ${bobTokens}, alice ${before} -> ${after}`,
    b.ok && bobTokens > 0n && before === after, [b.url, ...relayLinks(rb.steps)]);
  return p;
}

async function lotB() {
  const p = await provision({ contract, path: `gate1-b-${started.getTime()}`, owner: alice, issuer: alice });
  record("B: provision", "second fresh lot", `lot ${p.id} at ${p.address}`, true, [p.mint.url]);
  const id = p.id;

  const low = await requestClaim(contract, alice, id, aliceEvm, { fees: { max_fee: "1000000", max_prio: "1000000" } });
  const lowRaw = low.ok ? (low.value as Hex | null) : null;
  const sent = lowRaw ? await base.broadcast(lowRaw) : null;
  const lowHash = sent && "hash" in sent ? sent.hash : null;
  record("B: alice broadcasts first", "her claim is in the pool but priced below the base fee, so it can't mine yet",
    sent ? sent.status : low.ok ? "no raw" : low.error, sent?.status === "sent" || sent?.status === "known", [low.url, ...(lowHash ? [`pending ${base.txUrl(lowHash)}`] : [])]);

  const s = await seal(contract, alice, id, { max_fee: "1100000", max_prio: "1100000" });
  const stalled = (await lotOf(id)).issued.find(isBurn);
  const stalledRaw = stalled?.raw_tx;
  const stalledBroadcast = stalledRaw ? await base.broadcast(stalledRaw as Hex) : null;
  const earlyRescue = await rescue(contract, bob, id);
  const bumped = await rebump(contract, bob, id, 0);
  record("B: rebump the stuck burn after rescue", "the burn at nonce 0 stays repriceable with a rescue at nonce 1",
    `stalled broadcast=${stalledBroadcast?.status}; rescue=${earlyRescue.ok}; rebump=${bumped.ok}`,
    s.ok && (stalledBroadcast?.status === "sent" || stalledBroadcast?.status === "known") && earlyRescue.ok && bumped.ok,
    [s.url, earlyRescue.url, bumped.url]);
  const r = await relay(contract, bob, id, isBurn);
  const gone = lowHash ? (await base.receipt(lowHash)) === null : false;
  const again = lowRaw ? await base.broadcast(lowRaw) : null;
  record("B: burn replaces the pending claim", "burn mines at her nonce, her tx never mines, rebroadcast is rejected",
    `${r.lot.state}; alice's tx mined=${!gone}; rebroadcast: ${again && "message" in again ? again.message.split("\n")[0] : again?.status}`,
    r.lot.state === "Clean" && gone && again?.status === "nonce-too-low", [s.url, ...relayLinks(r.steps)]);

  const u = await call(alice, contract, "unseal", { id });
  const bad = await requestClaim(contract, alice, id, aliceEvm, { gasLimit: 30_000 });
  const rv = await relay(contract, bob, id, () => true);
  record("B: claim mines but reverts", "a reverted tx consumes the nonce but can never be proven",
    `reverted=${rv.reverted}, proven=${rv.proven}, next_nonce ${rv.lot.next_nonce}`, rv.reverted && !rv.proven, [u.url, bad.url, ...relayLinks(rv.steps)]);

  const s2 = await seal(contract, alice, id);
  const rs = await rescue(contract, bob, id);
  const rr = await relay(contract, bob, id, isBurn);
  record("B: rescue burn at the next nonce", "proving it proves the stuck nonce too: Clean",
    `${rr.lot.state} v${rr.lot.version}, next_nonce ${rr.lot.next_nonce}`, rr.lot.state === "Clean" && rr.lot.next_nonce === rv.lot.next_nonce + 2,
    [s2.url, rs.url, ...relayLinks(rr.steps)]);
  return p;
}

async function report(lots: { id: number; address: string }[], error?: unknown) {
  const pass = !error && rows.every((r) => r.pass);
  const lines = [
    `# Gate 1 run ${started.toISOString()}`,
    "",
    `Result: **${pass ? "PASS" : "FAIL"}**, ${rows.filter((r) => r.pass).length}/${rows.length} steps.`,
    "",
    `- contract: \`${contract}\`, finality **${await getFinality(contract)}**, code hash \`${await codeHash(contract)}\``,
    ...lots.map((l) => `- lot ${l.id} at \`${l.address}\``),
    "",
    "A proof shows the lot's outstanding nonce was consumed by one of its issued txs, not specifically the burn.",
    "",
    "| Step | Expected | Got | Pass |",
    "| --- | --- | --- | --- |",
    ...rows.map((r) => `| ${r.step} | ${r.expect} | ${r.got.replaceAll("|", "/")} | ${r.pass ? "yes" : "**no**"} |`),
    "",
    ...notes,
    "## Links",
    "",
    ...rows.flatMap((r) => (r.links.length ? [`- **${r.step}**`, ...r.links.map((l) => `  - ${l}`)] : [])),
    ...(error ? ["", "## Error", "", "```", String((error as Error).stack ?? error), "```"] : []),
    "",
  ];
  const file = new URL(`../../../reports/gate1-${started.toISOString().replaceAll(":", "-")}.md`, import.meta.url);
  await Bun.write(file, lines.join("\n"));
  console.log(`\n${pass ? "GATE 1 PASS" : "GATE 1 FAIL"}  report: ${file.pathname}`);
  return pass;
}

const lots: { id: number; address: string }[] = [];
let error: unknown;
try {
  lots.push(await lotA());
  lots.push(await lotB());
} catch (e) {
  error = e;
}
process.exit((await report(lots, error)) ? 0 : 1);
