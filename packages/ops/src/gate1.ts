/**
 * Gate 1: adversarial handover on fresh lots. Every step asserts what the security model promises,
 * and the run writes a report with every NEAR and Base link.
 *
 *   bun run gate1
 *
 * Each lot holds a real non-cancelable, non-transferable Sablier Lockup stream on Base Sepolia.
 * A withdrawal is: anyone pulls the stream into the lot, then the owner gets an MPC-signed ERC-20
 * transfer out of it.
 *
 * Lot A is the handover: withdraw, a retained withdrawal, seal, proof, the heist, an outsider pulling
 * during the listing, a sale with an issuer royalty, pulled payouts, the new owner withdraws.
 * Lot B covers the paths lot A can't: the seller broadcasts first and the burn replaces it, and a
 * transfer that mines but reverts, recovered by a rescue burn at the next nonce.
 */
import { parseTransaction, recoverTransactionAddress, type Address, type Hex } from "viem";
import { isBurn, type Lot } from "@quitclaim/shared";
import * as base from "./base.ts";
import { call, codeHash, getFinality, getLot, view } from "./near.ts";
import { env } from "./env.ts";
import { buy, list, position, provision, pullSource, rebump, relay, requestTransfer, rescue, seal, withdraw, type RelayStep } from "./lot.ts";
import * as sablier from "./sablier.ts";

const contract = env.lotContract();
const alice = process.env.ALICE_ACCOUNT ?? env.admin();
const bob = process.env.BOB_ACCOUNT ?? `bob.${env.admin()}`;
const issuer = process.env.ISSUER_ACCOUNT ?? env.admin();
const PRICE = 10n ** 23n;
const ROYALTY_BPS = 250;
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

/** Anyone pulls the stream into the lot; then the owner signs a transfer of what the lot holds. */
async function withdrawTo(signer: string, id: number, to: Address, override: Parameters<typeof requestTransfer>[4] = {}) {
  const pulled = await pullSource(await lotOf(id));
  const req = await requestTransfer(contract, signer, id, to, override);
  return { pulled, req };
}

const pulledLink = (tx: Hex | null) => (tx ? [`pull ${base.txUrl(tx)}`] : []);

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
    `- calldata: \`${tx.data}\` (token.transfer(to=alice, amount))`,
    "",
    "```",
    raw,
    "```",
    "",
  );
}

async function lotA() {
  const p = await provision({ contract, path: `gate1-a-${started.getTime()}`, owner: alice, issuer, royaltyBps: ROYALTY_BPS });
  record("A: provision", "Sablier stream pays the lot; title search clean; contract learns the address from MPC",
    `lot ${p.id} at ${p.address}, stream ${p.streamId}, ${JSON.stringify(p.title)}`, p.title.clean, [
    p.mint.url,
    `stream ${base.txUrl(p.streamTx)}`,
    `gas ${base.txUrl(p.fundTx)}`,
  ]);
  const id = p.id;

  const w0 = await withdrawTo(alice, id, aliceEvm);
  const c0 = w0.req;
  record("A: alice withdraws", "stream pulled into the lot; contract-built transfer(to=alice) signed", c0.ok ? "signed" : c0.error, c0.ok && !!c0.value, [...pulledLink(w0.pulled), c0.url]);
  const r0 = await relay(contract, bob, id, () => true);
  const aliceTokens = await base.tokenBalance(p.token, aliceEvm);
  record("A: prove withdrawal", "nonce 0 proven consumed, lot stays Active", `${r0.lot.state}, next_nonce ${r0.lot.next_nonce}, alice holds ${aliceTokens}`,
    r0.lot.state === "Active" && r0.lot.next_nonce === 1 && aliceTokens > 0n, relayLinks(r0.steps));

  const w1 = await withdrawTo(alice, id, aliceEvm);
  const c1 = w1.req;
  const retained = c1.ok ? (c1.value as Hex | null) : null;
  record("A: alice retains a withdrawal", "a valid signed transfer(to=alice) at nonce 1, never broadcast", retained ? "signed and kept" : c1.ok ? "no raw" : c1.error, !!retained, [c1.url]);
  if (retained) await describeRetained(retained);

  const t1 = await transfer(alice, id);
  record("A: transfer with an outstanding signed request", "refused: an unproven nonce means the lot is not Clean",
    t1.ok ? "accepted!" : t1.error, !t1.ok && t1.error.includes("not Clean"), [t1.url]);

  const s = await seal(contract, alice, id);
  const sealed = await lotOf(id);
  record("A: alice seals", "Sealing, burn signed at nonce 1 with both fees bumped", `${sealed.state}, issued ${sealed.issued.map((i) => (isBurn(i) ? "burn" : "claim")).join("+")}`,
    s.ok && sealed.state === "Sealing" && sealed.issued.some(isBurn), [s.url]);

  const refused = await requestTransfer(contract, alice, id, aliceEvm, { amount: 1n, gasLimit: 80_000 });
  record("A: alice requests while Sealing", "refused: lot is not Active", refused.ok ? "signed!" : refused.error, !refused.ok && refused.error.includes("not Active"), [refused.url]);

  const early = await list(contract, alice, id, PRICE);
  record("A: alice lists while Sealing", "refused: agreements only while Clean", early.ok ? "listed!" : early.error, !early.ok && early.error.includes("not Clean"), [early.url]);

  const r1 = await relay(contract, bob, id, isBurn);
  record("A: prove burn", "old nonce proven consumed: Clean", `${r1.lot.state} v${r1.lot.version}, next_nonce ${r1.lot.next_nonce}`, r1.lot.state === "Clean" && r1.lot.next_nonce === 2, relayLinks(r1.steps));

  const heist = retained ? await base.broadcast(retained) : null;
  record("A: alice broadcasts the retained withdrawal", "Base rejects it: its nonce was consumed", heist ? ("message" in heist ? heist.message.split("\n")[0]! : `accepted ${heist.hash}`) : "no retained tx",
    heist?.status === "nonce-too-low");

  const sellerBefore = BigInt(await view(contract, "proceeds_of", { account_id: alice }));
  const issuerBefore = BigInt(await view(contract, "proceeds_of", { account_id: issuer }));
  const l = await list(contract, alice, id, PRICE);
  const listed = await lotOf(id);
  record("A: alice lists the Clean lot", "listing bound to the current version", `price ${listed.listing?.price}, version ${listed.listing?.version}`,
    l.ok && listed.listing?.version === listed.version, [l.url]);

  const before = await position(listed);
  const outsider = await pullSource(listed);
  const after = await position(listed);
  const stillListed = await lotOf(id);
  record("A: outsider pulls the stream while listed", "value moves from the stream into the lot; the total never drops; the listing stands",
    `locked ${before.locked} -> ${after.locked}, held ${before.held} -> ${after.held}, total ${before.total} -> ${after.total}`,
    after.total === before.total && after.held >= before.held && stillListed.listing?.version === stillListed.version, pulledLink(outsider));

  const sale = await buy(contract, bob, id);
  const moved = await lotOf(id);
  const royalty = (PRICE * BigInt(ROYALTY_BPS)) / 10_000n;
  const sellerGot = BigInt(await view(contract, "proceeds_of", { account_id: alice })) - sellerBefore;
  const issuerGot = BigInt(await view(contract, "proceeds_of", { account_id: issuer })) - issuerBefore;
  record("A: bob buys", "one call moves the title and credits seller and issuer (2.5% royalty)",
    `${moved.owner} ${moved.state} v${moved.version}; seller +${sellerGot}, issuer +${issuerGot}`,
    sale.ok && moved.owner === bob && moved.state === "Active" && sellerGot === PRICE - royalty && issuerGot === royalty, [sale.url]);

  const ws = await withdraw(contract, alice);
  const wi = await withdraw(contract, issuer);
  record("A: seller and issuer withdraw", "pulled payouts transfer and zero the balances",
    `seller ${ws.ok ? ws.value : ws.error}, issuer ${wi.ok ? wi.value : wi.error}`,
    ws.ok && ws.value === true && wi.ok && wi.value === true && (await view(contract, "proceeds_of", { account_id: alice })) === "0", [ws.url, wi.url]);

  const locked = await requestTransfer(contract, alice, id, aliceEvm, { amount: 1n, gasLimit: 80_000 });
  record("A: alice requests after transfer", "refused: not the lot owner", locked.ok ? "signed!" : locked.error, !locked.ok && locked.error.includes("not the lot owner"), [locked.url]);

  const aliceBefore = await base.tokenBalance(p.token, aliceEvm);
  const wb = await withdrawTo(bob, id, bobEvm);
  const rb = await relay(contract, bob, id, () => true);
  const bobTokens = await base.tokenBalance(p.token, bobEvm);
  const aliceAfter = await base.tokenBalance(p.token, aliceEvm);
  const title = await sablier.titleSearch(p.streamId, p.address, p.token);
  record("A: bob withdraws", "bob's withdrawal pays bob; alice's balance unchanged; the stream still pays the same address",
    `bob holds ${bobTokens}, alice ${aliceBefore} -> ${aliceAfter}, title clean=${title.clean}`,
    wb.req.ok && bobTokens > 0n && aliceBefore === aliceAfter && title.clean, [...pulledLink(wb.pulled), wb.req.url, ...relayLinks(rb.steps)]);
  return p;
}

async function lotB() {
  const p = await provision({ contract, path: `gate1-b-${started.getTime()}`, owner: alice, issuer: alice });
  record("B: provision", "second fresh lot", `lot ${p.id} at ${p.address}`, true, [p.mint.url]);
  const id = p.id;

  const lowW = await withdrawTo(alice, id, aliceEvm, { fees: { max_fee: "1000000", max_prio: "1000000" } });
  const low = lowW.req;
  const lowRaw = low.ok ? (low.value as Hex | null) : null;
  const sent = lowRaw ? await base.broadcast(lowRaw) : null;
  const lowHash = sent && "hash" in sent ? sent.hash : null;
  record("B: alice broadcasts first", "her withdrawal is in the pool but priced below the base fee, so it can't mine yet",
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
  record("B: burn replaces the pending withdrawal", "burn mines at her nonce, her tx never mines, rebroadcast is rejected",
    `${r.lot.state}; alice's tx mined=${!gone}; rebroadcast: ${again && "message" in again ? again.message.split("\n")[0] : again?.status}`,
    r.lot.state === "Clean" && gone && again?.status === "nonce-too-low", [s.url, ...relayLinks(r.steps)]);

  const u = await call(alice, contract, "unseal", { id });
  const held = await base.tokenBalance(p.token, p.address);
  const bad = await requestTransfer(contract, alice, id, aliceEvm, { amount: held + 10n ** 30n, gasLimit: 80_000 });
  const rv = await relay(contract, bob, id, () => true);
  record("B: transfer mines but reverts", "more than the lot holds: the tx consumes the nonce but can never be proven",
    `reverted=${rv.reverted}, proven=${rv.proven}, next_nonce ${rv.lot.next_nonce}`, rv.reverted && !rv.proven, [u.url, bad.url, ...relayLinks(rv.steps)]);

  const s2 = await seal(contract, alice, id);
  const rs = await rescue(contract, bob, id);
  const rr = await relay(contract, bob, id, isBurn);
  record("B: rescue burn at the next nonce", "proving it proves the stuck nonce too: Clean",
    `${rr.lot.state} v${rr.lot.version}, next_nonce ${rr.lot.next_nonce}`, rr.lot.state === "Clean" && rr.lot.next_nonce === rv.lot.next_nonce + 2,
    [s2.url, rs.url, ...relayLinks(rr.steps)]);

  const issuerBefore = await view(contract, "proceeds_of", { account_id: alice });
  const t = await transfer(alice, id);
  const moved = await lotOf(id);
  const issuerAfter = await view(contract, "proceeds_of", { account_id: alice });
  record("B: direct transfer", "nft_transfer from Clean moves the title and pays no royalty",
    `${moved.owner} ${moved.state}; issuer proceeds ${issuerBefore} -> ${issuerAfter}`, t.ok && moved.owner === bob && issuerBefore === issuerAfter, [t.url]);
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
