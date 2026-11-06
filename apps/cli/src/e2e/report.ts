import {
  parseTransaction,
  recoverTransactionAddress,
  type Hex,
  type TransactionSerialized,
} from "viem";
import { logger } from "@quitclaim/sdk/logger.ts";
import type { Finality } from "@quitclaim/shared";
import * as base from "@quitclaim/sdk/base.ts";
import type { SettleStep } from "@quitclaim/sdk/settle.ts";
import { codeHash, fullAccessKeys, getFinality } from "@quitclaim/sdk/near.ts";
import { parseEvidence, type HeistRun } from "../heist-evidence.ts";

type Row = {
  step: string;
  expect: string;
  got: string;
  links: string[];
  pass: boolean;
};

/** One scenario run: rows of expected vs observed, notes, and every NEAR and Base link. */
export class Run {
  readonly rows: Row[] = [];
  readonly notes: string[] = [];
  readonly lots: { id: number; address: string }[] = [];
  readonly started = new Date();
  private readonly log;
  heist?: HeistRun;

  private constructor(
    readonly scenario: string,
    readonly contract: string,
    private readonly deployed: {
      finality: Finality;
      codeHash: string;
      fullAccessKeys: number;
    },
  ) {
    this.log = logger.child({ command: "e2e", scenario, contract });
  }

  /** Reads the deployment up front, so an RPC failure at the end can't lose the scenario's error and report. */
  static async start(scenario: string, contract: string) {
    const [finality, hash, keys] = await Promise.all([
      getFinality(contract),
      codeHash(contract),
      fullAccessKeys(contract),
    ]);
    return new Run(scenario, contract, {
      finality,
      codeHash: hash,
      fullAccessKeys: keys.length,
    });
  }

  record({
    step,
    expect,
    got,
    pass,
    links = [],
  }: Omit<Row, "links"> & { links?: string[] }) {
    this.rows.push({ step, expect, got, links, pass });
    this.log[pass ? "info" : "error"](
      { step, expect, got, pass, links },
      `${pass ? "PASS" : "FAIL"} ${step}`,
    );
  }

  async describeRetained(raw: Hex) {
    const tx = parseTransaction(raw);
    const from = await recoverTransactionAddress({
      serializedTransaction: raw as TransactionSerialized,
    });
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
    const pass =
      !error && this.rows.length > 0 && this.rows.every((r) => r.pass);
    if (error) this.log.error({ err: error }, "Scenario failed");
    const {
      finality,
      codeHash: hash,
      fullAccessKeys: recordedFullAccessKeys,
    } = this.deployed;
    const lines = [
      `# e2e ${this.scenario} ${this.started.toISOString()}`,
      "",
      `Result: **${pass ? "PASS" : "FAIL"}**, ${this.rows.filter((r) => r.pass).length}/${this.rows.length} steps.`,
      "",
      `- contract: \`${this.contract}\`, finality **${finality}**, code hash \`${hash}\``,
      ...this.lots.map((l) => `- lot ${l.id} at \`${l.address}\``),
      "",
      "A proof shows the lot's outstanding nonce was consumed by one of its issued txs, not specifically the burn.",
      "",
      "| Step | Expected | Got | Pass |",
      "| --- | --- | --- | --- |",
      ...this.rows.map(
        (r) =>
          `| ${r.step} | ${r.expect} | ${r.got.replaceAll("|", "/")} | ${r.pass ? "yes" : "**no**"} |`,
      ),
      "",
      ...this.notes,
      "## Links",
      "",
      ...this.rows.flatMap((r) =>
        r.links.length
          ? [`- **${r.step}**`, ...r.links.map((l) => `  - ${l}`)]
          : [],
      ),
      ...(error
        ? [
            "",
            "## Error",
            "",
            "```",
            error instanceof Error
              ? (error.stack ?? error.message)
              : String(error),
            "```",
          ]
        : []),
      "",
    ];
    const stamp = this.started.toISOString().replaceAll(":", "-");
    const file = new URL(
      `../../../../reports/e2e-${this.scenario}-${stamp}.md`,
      import.meta.url,
    );
    await Bun.write(file, lines.join("\n"));
    if (pass && this.heist) {
      const evidence = parseEvidence({
        ...this.heist,
        version: 1,
        recordedAt: this.started.toISOString(),
        report: `e2e-${this.scenario}-${stamp}.md`,
        codeHash: hash,
        finality,
        recordedFullAccessKeys,
      });
      const artifact = new URL(
        `../../../../reports/heist-${stamp}.json`,
        import.meta.url,
      );
      await Bun.write(artifact, `${JSON.stringify(evidence, null, 2)}\n`);
      this.log.info({ evidence: artifact.pathname }, "Heist evidence written");
    }
    this.log[pass ? "info" : "error"](
      { pass, report: file.pathname },
      `${pass ? "PASS" : "FAIL"} e2e ${this.scenario}`,
    );
    return pass;
  }
}

export function settleLinks(steps: SettleStep[]) {
  return steps.flatMap((step) => {
    switch (step.kind) {
      case "seal":
        return [`seal ${step.outcome.url}`];
      case "end_lease":
        return [`end lease ${step.outcome.url}`];
      case "topup":
        return [`top-up ${base.txUrl(step.tx)}`];
      case "broadcast":
        return "hash" in step.result
          ? [`broadcast ${base.txUrl(step.result.hash)}`]
          : [];
      case "mined":
        return [
          `mined (${step.status}) block ${step.block} ${base.txUrl(step.tx)}`,
        ];
      case "rescue":
        return [`rescue ${step.outcome.url}`];
      case "rebump":
        return [`rebump nonce ${step.nonce} ${step.outcome.url}`];
      case "prove":
        return [`prove ${step.outcome.url}`];
      default: {
        const exhaustive: never = step;
        return exhaustive;
      }
    }
  });
}

export const firstLine = (b: base.Broadcast | null) =>
  b ? ("message" in b ? b.message.split("\n")[0]! : b.status) : "none";
