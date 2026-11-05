/**
 * The keeper settles lots: it tops up gas, broadcasts issued txs, waits for one to mine and for the
 * contract's finality, proves it, and rescues a lot whose outstanding tx reverted. Every action it
 * takes is permissionless on chain, so anyone can run one.
 *
 *   bun run keeper            settle every lot with unproven txs once
 *   bun run keeper --watch    keep settling
 */
import type { Address, Hex } from "viem";
import { isBurn, type Issued, type Lot } from "@quitclaim/shared";
import * as base from "./base.ts";
import { env } from "./env.ts";
import { mustLot, rescue } from "./lot.ts";
import { call, getFinality, view, type CallOutcome } from "./near.ts";

const YOCTO = 1n;

export type SettleStep =
  | { kind: "topup"; seq: number; tx: Hex }
  | { kind: "broadcast"; seq: number; result: base.Broadcast }
  | { kind: "mined"; seq: number; tx: Hex; block: bigint; status: "success" | "reverted" }
  | { kind: "rescue"; outcome: CallOutcome<unknown> }
  | { kind: "prove"; seq: number; outcome: CallOutcome<boolean> };

export type Settled = { steps: SettleStep[]; lot: Lot; proven: boolean; reverted: boolean };

/**
 * What the keeper may broadcast. While Sealing only burns go out: the seller's own pending
 * transfers are theirs to broadcast, and the burn exists to make them unexecutable.
 */
const broadcastable = (lot: Lot) => (i: Issued) => !!i.raw_tx && (lot.state === "Sealing" ? isBurn(i) : true);

async function broadcastAll(lot: Lot, steps: SettleStep[]) {
  for (const i of lot.issued.filter(broadcastable(lot))) {
    const raw = i.raw_tx as Hex;
    const topup = await base.ensureBalance(lot.address as Address, await base.maxCost(raw));
    if (topup) steps.push({ kind: "topup", seq: i.seq, tx: topup });
    steps.push({ kind: "broadcast", seq: i.seq, result: await base.broadcast(raw) });
  }
}

/** Waits for an issued tx to mine. Returns the highest-nonce success, and whether any reverted. */
async function awaitMined(lot: Lot, steps: SettleStep[], timeoutMs = 180_000) {
  const seen = new Set<number>();
  let mined: { issued: Issued; block: bigint } | null = null;
  let reverted = false;
  const deadline = Date.now() + timeoutMs;
  while (!mined && Date.now() < deadline) {
    for (const i of lot.issued.filter((i) => i.tx_hash && !seen.has(i.seq))) {
      const r = await base.receipt(i.tx_hash as Hex);
      if (!r) continue;
      seen.add(i.seq);
      steps.push({ kind: "mined", seq: i.seq, tx: r.transactionHash, block: r.blockNumber, status: r.status });
      if (r.status === "reverted") reverted = true;
      else if (!mined || i.nonce > mined.issued.nonce) mined = { issued: i, block: r.blockNumber };
    }
    if (!mined && reverted && !lot.issued.some((i) => i.nonce > lot.next_nonce)) break;
    if (!mined) await Bun.sleep(3_000);
  }
  return { mined, reverted };
}

/** Drives one lot until its outstanding nonce is proven consumed, or reports that it can't be yet. */
export async function settle(contract: string, prover: string, id: number): Promise<Settled> {
  const steps: SettleStep[] = [];
  let lot = await mustLot(contract, id);
  await broadcastAll(lot, steps);
  let { mined, reverted } = await awaitMined(lot, steps);

  const rescued = lot.issued.some((i) => i.nonce > lot.next_nonce);
  if (!mined && reverted && lot.state === "Sealing" && !rescued) {
    steps.push({ kind: "rescue", outcome: await rescue(contract, prover, id) });
    lot = await mustLot(contract, id);
    await broadcastAll(lot, steps);
    ({ mined } = await awaitMined(lot, steps));
  }
  if (!mined) {
    if (reverted) return { steps, lot: await mustLot(contract, id), proven: false, reverted };
    throw new Error(`no issued tx for lot ${id} mined within 180 s`);
  }

  await base.waitFinality(mined.block, await getFinality(contract));
  const outcome = await call(prover, contract, "prove", { id, seq: mined.issued.seq }, { deposit: YOCTO });
  steps.push({ kind: "prove", seq: mined.issued.seq, outcome });
  return { steps, lot: await mustLot(contract, id), proven: outcome.ok && outcome.value === true, reverted };
}

/** Lots with a signed tx the contract hasn't seen proven yet. */
async function pending(contract: string) {
  const tokens = await view(contract, "nft_tokens", { from_index: null, limit: null });
  const lots = await Promise.all(tokens.map(async (t) => ({ id: Number(t.token_id), lot: await mustLot(contract, Number(t.token_id)) })));
  return lots.filter(({ lot }) => lot.issued.some((i) => i.tx_hash));
}

if (import.meta.main) {
  const contract = env.lotContract();
  const prover = process.env.KEEPER_ACCOUNT ?? env.admin();
  const watch = Bun.argv.includes("--watch");
  do {
    for (const { id } of await pending(contract)) {
      try {
        const r = await settle(contract, prover, id);
        console.log(`lot ${id}: ${r.lot.state} next_nonce ${r.lot.next_nonce} proven=${r.proven} reverted=${r.reverted}`);
      } catch (e) {
        console.log(`lot ${id}: ${(e as Error).message}`);
      }
    }
    if (watch) await Bun.sleep(30_000);
  } while (watch);
}
