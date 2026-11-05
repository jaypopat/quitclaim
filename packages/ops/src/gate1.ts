/**
 * Gate 1: adversarial handover on a fresh lot. Every step asserts what the security model
 * promises and the run writes a report with every NEAR and Base link.
 *
 *   bun run gate1
 */
import type { Address, Hex } from "viem";
import { isBurn } from "@quitclaim/shared";
import * as base from "./base.ts";
import { call, getLot } from "./near.ts";
import { env } from "./env.ts";
import { provision, relay, requestClaim, seal, type RelayStep } from "./lot.ts";

const contract = env.lotContract();
const alice = process.env.ALICE_ACCOUNT ?? env.admin();
const bob = process.env.BOB_ACCOUNT ?? `bob.${env.admin()}`;
const aliceEvm: Address = "0x000000000000000000000000000000000000a11c";
const bobEvm: Address = "0x0000000000000000000000000000000000000b0b";

type Row = { step: string; expect: string; got: string; links: string[]; pass: boolean };
const rows: Row[] = [];
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
    if (s.kind === "mined") return [`mined block ${s.block} ${base.txUrl(s.tx)}`];
    if (s.kind === "prove") return [`prove ${s.outcome.url}`];
    return [];
  });
}

const lotOf = async (id: number) => {
  const lot = await getLot(contract, id);
  if (!lot) throw new Error(`lot ${id} missing`);
  return lot;
};

async function main() {
  const path = `gate1-${started.getTime()}`;
  const p = await provision({ contract, path, owner: alice, issuer: alice });
  record("provision", "contract learns the derived address from MPC", `lot ${p.id} at ${p.address}, vesting ${p.vesting}`, true, [
    p.mint.url,
    `vesting ${base.txUrl(p.vestingTx)}`,
    `gas ${base.txUrl(p.fundTx)}`,
  ]);
  const id = p.id;

  const c0 = await requestClaim(contract, alice, id, aliceEvm);
  record("alice claim 0", "contract-built claim(to=alice) signed", c0.ok ? "signed" : c0.error, c0.ok && !!c0.value, [c0.url]);
  const r0 = await relay(contract, bob, id, () => true);
  const aliceTokens = await base.tokenBalance(p.vesting, aliceEvm);
  record("prove claim 0", "nonce 0 proven consumed, lot stays Active", `${r0.lot.state}, next_nonce ${r0.lot.next_nonce}, alice holds ${aliceTokens}`,
    r0.lot.state === "Active" && r0.lot.next_nonce === 1 && aliceTokens > 0n, relayLinks(r0.steps));

  const c1 = await requestClaim(contract, alice, id, aliceEvm);
  const retained = c1.ok ? (c1.value as Hex | null) : null;
  record("alice retains claim 1", "a valid signed claim(to=alice) at nonce 1, never broadcast", retained ? `${retained.slice(0, 26)}…` : c1.ok ? "no raw" : c1.error, !!retained, [c1.url]);

  const early = await call(alice, contract, "nft_transfer", { receiver_id: bob, token_id: String(id) }, { deposit: 1n });
  record("transfer with a pending request", "refused: lot is not Clean", early.ok ? "transferred!" : early.error, !early.ok && early.error.includes("not Clean"), [early.url]);

  const s = await seal(contract, alice, id);
  const sealed = await lotOf(id);
  record("alice seals", "Sealing, burn signed at nonce 1 with both fees bumped", `${sealed.state}, issued ${sealed.issued.map((i) => (isBurn(i) ? "burn" : "claim")).join("+")}`,
    s.ok && sealed.state === "Sealing" && sealed.issued.some(isBurn), [s.url]);

  const refused = await requestClaim(contract, alice, id, aliceEvm);
  record("alice requests while Sealing", "refused: lot is not Active", refused.ok ? "signed!" : refused.error, !refused.ok && refused.error.includes("not Active"), [refused.url]);

  const r1 = await relay(contract, bob, id, isBurn);
  record("prove burn", "burn mined and proven: Clean", `${r1.lot.state} v${r1.lot.version}, next_nonce ${r1.lot.next_nonce}`, r1.lot.state === "Clean" && r1.lot.next_nonce === 2, relayLinks(r1.steps));

  const heist = retained ? await base.broadcast(retained) : null;
  record("alice broadcasts the retained claim", "Base rejects it: its nonce was consumed", heist ? ("message" in heist ? heist.message.split("\n")[0]! : `accepted ${heist.hash}`) : "no retained tx",
    heist?.status === "nonce-too-low");

  const t = await call(alice, contract, "nft_transfer", { receiver_id: bob, token_id: String(id) }, { deposit: 1n });
  const moved = await lotOf(id);
  record("transfer to bob", "title moves only from Clean; lot Active for bob", `${moved.owner} ${moved.state} v${moved.version}`, t.ok && moved.owner === bob && moved.state === "Active", [t.url]);

  const locked = await requestClaim(contract, alice, id, aliceEvm);
  record("alice requests after transfer", "refused: not the lot owner", locked.ok ? "signed!" : locked.error, !locked.ok && locked.error.includes("not the lot owner"), [locked.url]);

  const before = await base.tokenBalance(p.vesting, aliceEvm);
  const b = await requestClaim(contract, bob, id, bobEvm);
  const rb = await relay(contract, bob, id, () => true);
  const bobTokens = await base.tokenBalance(p.vesting, bobEvm);
  const after = await base.tokenBalance(p.vesting, aliceEvm);
  record("bob claims", "bob's claim pays bob; alice's balance unchanged", `bob holds ${bobTokens}, alice ${before} -> ${after}`,
    b.ok && bobTokens > 0n && before === after, [b.url, ...relayLinks(rb.steps)]);

  return { id, path, address: p.address, vesting: p.vesting };
}

async function report(lot: { id: number; path: string; address: string; vesting: string } | null, error?: unknown) {
  const pass = !error && rows.every((r) => r.pass);
  const lines = [
    `# Gate 1 run ${started.toISOString()}`,
    "",
    `Result: **${pass ? "PASS" : "FAIL"}**. Contract \`${contract}\`${lot ? `, lot ${lot.id} (\`${lot.path}\`) at \`${lot.address}\`, vesting \`${lot.vesting}\`` : ""}.`,
    "",
    "| Step | Expected | Got | Pass |",
    "| --- | --- | --- | --- |",
    ...rows.map((r) => `| ${r.step} | ${r.expect} | ${r.got.replaceAll("|", "/")} | ${r.pass ? "yes" : "**no**"} |`),
    "",
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

const result = await main().then((lot) => report(lot), (e) => report(null, e));
process.exit(result ? 0 : 1);
