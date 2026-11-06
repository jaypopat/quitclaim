/**
 * The keeper settles lots: it seals a lot whose lease has run out (or ends the lease if the lot is
 * already Clean), tops up gas, broadcasts issued txs, waits for one to mine and for the contract's
 * finality, proves it, reprices a stalled burn, and rescues a lot whose outstanding tx reverted.
 * Every action it takes is permissionless on chain, so anyone can run one.
 *
 *   bun run keeper            settle every lot with unproven txs or a run-out lease once
 *   bun run keeper --watch    keep settling
 */
import type { Address, Hex } from "viem";
import { isBurn, type Issued, type Lot } from "@quitclaim/shared";
import * as base from "./base.ts";
import { env } from "./env.ts";
import { endLease, leaseRunOut, mustLot, rebump, rescue, seal } from "./lot.ts";
import { call, getFinality, view, YOCTO, type CallOutcome } from "./near.ts";
import { pendingLots } from "./pending.ts";
import { logger } from "./logger.ts";

export type SettleStep =
  | { kind: "seal"; outcome: CallOutcome<unknown> }
  | { kind: "end_lease"; outcome: CallOutcome<unknown> }
  | { kind: "topup"; seq: number; tx: Hex }
  | { kind: "broadcast"; seq: number; result: base.Broadcast }
  | {
      kind: "mined";
      seq: number;
      tx: Hex;
      block: bigint;
      status: "success" | "reverted";
    }
  | { kind: "rescue"; outcome: CallOutcome<unknown> }
  | { kind: "rebump"; nonce: number; outcome: CallOutcome<unknown> }
  | { kind: "prove"; seq: number; outcome: CallOutcome<boolean> };

export type Settled = {
  steps: SettleStep[];
  lot: Lot;
  proven: boolean;
  reverted: boolean;
};

export function provenMined(steps: SettleStep[]) {
  for (const proof of steps.toReversed()) {
    if (proof.kind !== "prove" || !proof.outcome.ok || !proof.outcome.value)
      continue;
    const mined = steps.find(
      (step): step is Extract<SettleStep, { kind: "mined" }> =>
        step.kind === "mined" &&
        step.seq === proof.seq &&
        step.status === "success",
    );
    if (mined) return { proof, mined };
  }
  return undefined;
}

/**
 * What the keeper may broadcast. While Sealing only burns go out: the seller's own pending
 * transfers are theirs to broadcast, and the burn exists to make them unexecutable.
 */
const broadcastable = (lot: Lot) => (i: Issued) =>
  !!i.raw_tx && (lot.state === "Sealing" ? isBurn(i) : true);

async function broadcastAll(lot: Lot, steps: SettleStep[]) {
  for (const i of lot.issued.filter(broadcastable(lot))) {
    const raw = i.raw_tx as Hex;
    const topup = await base.ensureBalance(
      lot.address as Address,
      await base.maxCost(raw),
    );
    if (topup) steps.push({ kind: "topup", seq: i.seq, tx: topup });
    steps.push({
      kind: "broadcast",
      seq: i.seq,
      result: await base.broadcast(raw),
    });
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
      steps.push({
        kind: "mined",
        seq: i.seq,
        tx: r.transactionHash,
        block: r.blockNumber,
        status: r.status,
      });
      if (r.status === "reverted") reverted = true;
      else if (!mined || i.nonce > mined.issued.nonce)
        mined = { issued: i, block: r.blockNumber };
    }
    if (!mined && reverted && !lot.issued.some((i) => i.nonce > lot.next_nonce))
      break;
    if (!mined) await Bun.sleep(3_000);
  }
  return { mined, reverted };
}

const MAX_ROUNDS = 6;

/** A burn priced below the current base fee can't mine; while Sealing anyone may reprice it. */
async function stalledBurn(lot: Lot) {
  if (lot.state !== "Sealing") return null;
  const baseFee = (await base.pub.getBlock()).baseFeePerGas ?? 0n;
  const burns = lot.issued.filter(isBurn);
  const nonces = [...new Set(burns.map((b) => b.nonce))];
  for (const nonce of nonces) {
    const best = burns
      .filter((b) => b.nonce === nonce)
      .reduce(
        (m, b) => (BigInt(b.fees.max_fee) > m ? BigInt(b.fees.max_fee) : m),
        0n,
      );
    if (best < baseFee) return nonce;
  }
  return null;
}

/**
 * Drives one lot until nothing it issued is left unproven: seal a run-out lease, broadcast, wait,
 * rescue a reverted nonce, reprice a stalled burn, prove, and go again while a Sealing lot still has
 * outstanding txs. The proof that makes a run-out lease's lot Clean also ends the lease.
 */
export async function settle(
  contract: string,
  prover: string,
  id: number,
): Promise<Settled> {
  const steps: SettleStep[] = [];
  let reverted = false;
  let proven = false;
  const start = await mustLot(contract, id);
  if (leaseRunOut(start) && start.state === "Active")
    steps.push({ kind: "seal", outcome: await seal(contract, prover, id) });
  if (leaseRunOut(start) && start.state === "Clean")
    steps.push({
      kind: "end_lease",
      outcome: await endLease(contract, prover, id),
    });
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const lot = await mustLot(contract, id);
    if (!lot.issued.some((i) => i.tx_hash)) break;
    await broadcastAll(lot, steps);
    const seen = await awaitMined(lot, steps, 90_000);
    reverted ||= seen.reverted;

    if (!seen.mined) {
      const rescued = lot.issued.some((i) => i.nonce > lot.next_nonce);
      if (seen.reverted && lot.state === "Sealing" && !rescued) {
        steps.push({
          kind: "rescue",
          outcome: await rescue(contract, prover, id),
        });
        continue;
      }
      const stalled = await stalledBurn(lot);
      if (stalled !== null) {
        steps.push({
          kind: "rebump",
          nonce: stalled,
          outcome: await rebump(contract, prover, id, stalled),
        });
        continue;
      }
      if (seen.reverted) break;
      continue;
    }

    await base.waitFinality(seen.mined.block, await getFinality(contract));
    const outcome = await call(
      prover,
      contract,
      "prove",
      { id, seq: seen.mined.issued.seq },
      { deposit: YOCTO },
    );
    steps.push({ kind: "prove", seq: seen.mined.issued.seq, outcome });
    proven ||= outcome.ok && outcome.value === true;
    const after = await mustLot(contract, id);
    if (after.state !== "Sealing" || after.issued.length === 0) break;
  }
  const lot = await mustLot(contract, id);
  if (!proven && !reverted && lot.issued.some((i) => i.tx_hash))
    throw new Error(`lot ${id}: nothing mined after ${MAX_ROUNDS} rounds`);
  return { steps, lot, proven, reverted };
}

/** Lots with a signed tx the contract hasn't seen proven yet, or a lease that has run out. */
function pending(contract: string) {
  return pendingLots(
    (from_index, limit) => view(contract, "nft_tokens", { from_index, limit }),
    async (id) => {
      const lot = await mustLot(contract, id);
      return lot.issued.some((i) => i.tx_hash) || leaseRunOut(lot);
    },
  );
}

if (import.meta.main) {
  const contract = env.lotContract();
  const prover = env.keeper();
  const watch = Bun.argv.includes("--watch");
  const log = logger.child({ command: "keeper", contract });
  do {
    for (const id of await pending(contract)) {
      try {
        const r = await settle(contract, prover, id);
        log.info(
          {
            lot: id,
            state: r.lot.state,
            nextNonce: r.lot.next_nonce,
            proven: r.proven,
            reverted: r.reverted,
          },
          "Settlement completed",
        );
      } catch (err) {
        log.error({ err, lot: id }, "Settlement failed");
      }
    }
    if (watch) await Bun.sleep(30_000);
  } while (watch);
}
