import type { Address, Hex } from "viem";
import { fetchLotAddress, isBurn, nextFees, type Fees, type Issued, type Lot } from "@quitclaim/shared";
import * as base from "./base.ts";
import { call, getFinality, getLot, type CallOutcome } from "./near.ts";
import { env } from "./env.ts";

const YOCTO = 1n;

export type Provisioned = { id: number; address: Address; vesting: Address; vestingTx: Hex; fundTx: Hex; mint: CallOutcome<unknown> };

/** Issuer provisioning: derive the address, create the position at it, fund gas, mint the title. */
export async function provision(opts: {
  contract: string;
  path: string;
  owner: string;
  issuer: string;
  durationSec?: bigint;
  total?: bigint;
  gasFund?: bigint;
}): Promise<Provisioned> {
  const address = await fetchLotAddress(opts.contract, opts.path);
  const vesting = await base.deployVesting(address, opts.durationSec ?? 7n * 86400n, opts.total ?? 1_000_000n * 10n ** 18n);
  const fundTx = await base.fund(address, opts.gasFund ?? 2_000_000_000_000_000n);
  const mint = await call<{ id: number; address: string } | null>(env.admin(), opts.contract, "mint", {
    path: opts.path,
    vesting: vesting.address,
    owner_id: opts.owner,
    issuer: opts.issuer,
  });
  if (!mint.ok || !mint.value) throw new Error(`mint failed: ${mint.ok ? "derivation rolled back" : mint.error}`);
  if (mint.value.address.toLowerCase() !== address.toLowerCase()) {
    throw new Error(`contract derived ${mint.value.address}, expected ${address}`);
  }
  return { id: mint.value.id, address, vesting: vesting.address, vestingTx: vesting.tx, fundTx, mint };
}

async function floor(lot: Lot, nonce: number): Promise<Fees> {
  const f = await base.floorFees();
  return nextFees(lot.issued, nonce, { maxFee: f.maxFee, maxPrio: f.maxPrio });
}

const mustLot = async (contract: string, id: number) => {
  const lot = await getLot(contract, id);
  if (!lot) throw new Error(`no lot ${id}`);
  return lot;
};

export async function requestClaim(contract: string, signer: string, id: number, to: Address) {
  const lot = await mustLot(contract, id);
  const gas = await base.estimateClaimGas(lot.vesting as Address, lot.address as Address, to);
  return call<string | null>(signer, contract, "request_claim", {
    id,
    to,
    gas_limit: Number(gas),
    fees: await floor(lot, lot.next_nonce),
  }, { deposit: YOCTO });
}

export async function seal(contract: string, signer: string, id: number) {
  const lot = await mustLot(contract, id);
  return call<string | null | string>(signer, contract, "seal", { id, fees: await floor(lot, lot.next_nonce) }, { deposit: YOCTO });
}

export async function rebump(contract: string, signer: string, id: number) {
  const lot = await mustLot(contract, id);
  const nonce = Math.max(lot.next_nonce, ...lot.issued.map((i) => i.nonce));
  return call<string | null>(signer, contract, "rebump", { id, fees: await floor(lot, nonce) }, { deposit: YOCTO });
}

export type RelayStep =
  | { kind: "topup"; seq: number; tx: Hex }
  | { kind: "broadcast"; seq: number; result: base.Broadcast }
  | { kind: "mined"; seq: number; tx: Hex; block: bigint; status: "success" | "reverted" }
  | { kind: "prove"; seq: number; outcome: CallOutcome<boolean> };

/**
 * Broadcasts the selected issued txs, waits for one to mine, waits for the contract's finality,
 * then proves it. Safe to rerun: already-known and already-consumed txs are not errors.
 */
export async function relay(contract: string, prover: string, id: number, pick: (i: Issued) => boolean = isBurn) {
  const steps: RelayStep[] = [];
  const lot = await mustLot(contract, id);
  for (const i of lot.issued.filter((i) => i.raw_tx && pick(i))) {
    const raw = i.raw_tx as Hex;
    const topup = await base.ensureBalance(lot.address as Address, await base.maxCost(raw));
    if (topup) steps.push({ kind: "topup", seq: i.seq, tx: topup });
    steps.push({ kind: "broadcast", seq: i.seq, result: await base.broadcast(raw) });
  }

  const deadline = Date.now() + 180_000;
  let mined: { issued: Issued; block: bigint } | null = null;
  while (!mined && Date.now() < deadline) {
    for (const i of lot.issued.filter((i) => i.tx_hash)) {
      const r = await base.receipt(i.tx_hash as Hex);
      if (!r) continue;
      steps.push({ kind: "mined", seq: i.seq, tx: r.transactionHash, block: r.blockNumber, status: r.status });
      if (r.status === "reverted") throw new Error(`issued seq ${i.seq} reverted at nonce ${i.nonce}: use rescue`);
      mined = { issued: i, block: r.blockNumber };
      break;
    }
    if (!mined) await Bun.sleep(3_000);
  }
  if (!mined) throw new Error(`no issued tx for lot ${id} mined within 180 s`);

  await base.waitFinality(mined.block, await getFinality(contract));
  const outcome = await call<boolean>(prover, contract, "prove", { id, seq: mined.issued.seq }, { deposit: YOCTO });
  steps.push({ kind: "prove", seq: mined.issued.seq, outcome });
  return { steps, lot: await mustLot(contract, id) };
}
