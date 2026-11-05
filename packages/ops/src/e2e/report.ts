import { parseTransaction, recoverTransactionAddress, type Hex } from "viem";
import * as base from "../base.ts";
import type { SettleStep } from "../keeper.ts";
import { codeHash, getFinality } from "../near.ts";

type Row = { step: string; expect: string; got: string; links: string[]; pass: boolean };

/** One scenario run: rows of expected vs observed, notes, and every NEAR and Base link. */
export class Run {
  readonly rows: Row[] = [];
  readonly notes: string[] = [];
  readonly lots: { id: number; address: string }[] = [];
  readonly started = new Date();

  constructor(
    readonly scenario: string,
    readonly contract: string,
  ) {}

  record(step: string, expect: string, got: string, pass: boolean, links: string[] = []) {
    this.rows.push({ step, expect, got, links, pass });
    console.log(`${pass ? "PASS" : "FAIL"}  ${step}: ${got}`);
    for (const l of links) console.log(`      ${l}`);
  }

  async describeRetained(raw: Hex) {
    const tx = parseTransaction(raw);
    const from = await recoverTransactionAddress({ serializedTransaction: raw as never });
    this.notes.push(
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

  async write(error?: unknown) {
    const pass = !error && this.rows.length > 0 && this.rows.every((r) => r.pass);
    const lines = [
      `# e2e ${this.scenario} ${this.started.toISOString()}`,
      "",
      `Result: **${pass ? "PASS" : "FAIL"}**, ${this.rows.filter((r) => r.pass).length}/${this.rows.length} steps.`,
      "",
      `- contract: \`${this.contract}\`, finality **${await getFinality(this.contract)}**, code hash \`${await codeHash(this.contract)}\``,
      ...this.lots.map((l) => `- lot ${l.id} at \`${l.address}\``),
      "",
      "A proof shows the lot's outstanding nonce was consumed by one of its issued txs, not specifically the burn.",
      "",
      "| Step | Expected | Got | Pass |",
      "| --- | --- | --- | --- |",
      ...this.rows.map((r) => `| ${r.step} | ${r.expect} | ${r.got.replaceAll("|", "/")} | ${r.pass ? "yes" : "**no**"} |`),
      "",
      ...this.notes,
      "## Links",
      "",
      ...this.rows.flatMap((r) => (r.links.length ? [`- **${r.step}**`, ...r.links.map((l) => `  - ${l}`)] : [])),
      ...(error ? ["", "## Error", "", "```", String((error as Error).stack ?? error), "```"] : []),
      "",
    ];
    const stamp = this.started.toISOString().replaceAll(":", "-");
    const file = new URL(`../../../../reports/e2e-${this.scenario}-${stamp}.md`, import.meta.url);
    await Bun.write(file, lines.join("\n"));
    console.log(`\n${pass ? "PASS" : "FAIL"} e2e ${this.scenario}  report: ${file.pathname}`);
    return pass;
  }
}

export function settleLinks(steps: SettleStep[]) {
  return steps.flatMap((s) => {
    if (s.kind === "topup") return [`top-up ${base.txUrl(s.tx)}`];
    if (s.kind === "broadcast" && "hash" in s.result) return [`broadcast ${base.txUrl(s.result.hash)}`];
    if (s.kind === "mined") return [`mined (${s.status}) block ${s.block} ${base.txUrl(s.tx)}`];
    if (s.kind === "rescue") return [`rescue ${s.outcome.url}`];
    if (s.kind === "prove") return [`prove ${s.outcome.url}`];
    return [];
  });
}

export const firstLine = (b: base.Broadcast | null) => (b ? ("message" in b ? b.message.split("\n")[0]! : b.status) : "none");
