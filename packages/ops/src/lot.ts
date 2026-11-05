import type { Address, Hex } from "viem";
import { fetchLotAddress, isBurn, nextFees, type Fees, type Issued, type Lot, type LotCalls } from "@quitclaim/shared";
import * as base from "./base.ts";
import * as sablier from "./sablier.ts";
import { call, getFinality, getLot, type CallOutcome } from "./near.ts";
import { env } from "./env.ts";

const YOCTO = 1n;

export type Provisioned = {
  id: number;
  address: Address;
  token: Address;
  streamId: bigint;
  streamTx: Hex;
  fundTx: Hex;
  title: sablier.TitleSearch;
  mint: CallOutcome<LotCalls["mint"]["result"]>;
};

/**
 * Issuer provisioning: derive the address, create a non-cancelable, non-transferable Sablier stream
 * paying it, title-search the stream, fund gas, and mint the title bound to the token and stream.
 */
export async function provision(opts: {
  contract: string;
  path: string;
  owner: string;
  issuer: string;
  royaltyBps?: number;
  durationSec?: number;
  total?: bigint;
  gasFund?: bigint;
}): Promise<Provisioned> {
  const token = env.token();
  const address = await fetchLotAddress(opts.contract, opts.path);
  const stream = await sablier.createStream(address, token, opts.total ?? 1_000n * 10n ** 18n, opts.durationSec ?? 3_600);
  const title = await sablier.titleSearch(stream.id, address, token);
  if (!title.clean) throw new Error(`stream ${stream.id} fails title search: ${JSON.stringify(title)}`);
  const fundTx = await base.fund(address, opts.gasFund ?? 2_000_000_000_000_000n);
  const mint = await call(env.admin(), opts.contract, "mint", {
    path: opts.path,
    token,
    source: { kind: sablier.SOURCE_KIND, contract: sablier.LOCKUP, id: stream.id.toString() },
    owner_id: opts.owner,
    issuer: opts.issuer,
    royalty_bps: opts.royaltyBps ?? 250,
  });
  if (!mint.ok || !mint.value) throw new Error(`mint failed: ${mint.ok ? "derivation rolled back" : mint.error}`);
  if (mint.value.address.toLowerCase() !== address.toLowerCase()) {
    throw new Error(`contract derived ${mint.value.address}, expected ${address}`);
  }
  return { id: mint.value.id, address, token, streamId: stream.id, streamTx: stream.tx, fundTx, title, mint };
}

/** Moves whatever the lot's stream has vested into the lot. Anyone may do this. */
export async function pullSource(lot: Lot) {
  if (!lot.source) return null;
  return sablier.pull(BigInt(lot.source.id), lot.address as Address);
}

/** The lot's whole position in token units: still in the stream plus already held at the address. */
export async function position(lot: Lot) {
  const held = await base.tokenBalance(lot.token as Address, lot.address as Address);
  const locked = lot.source ? await sablier.remaining(BigInt(lot.source.id)) : 0n;
  return { held, locked, total: held + locked };
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

/** Owner moves tokens out of the lot. `amount` defaults to everything the lot holds right now. */
export async function requestTransfer(
  contract: string,
  signer: string,
  id: number,
  to: Address,
  override: { amount?: bigint; gasLimit?: number; fees?: Fees } = {},
) {
  const lot = await mustLot(contract, id);
  const amount = override.amount ?? (await base.tokenBalance(lot.token as Address, lot.address as Address));
  const gas = override.gasLimit ?? Number(await base.estimateTransferGas(lot.token as Address, lot.address as Address, to, amount));
  return call(signer, contract, "request_transfer", {
    id,
    to,
    amount: amount.toString(),
    gas_limit: gas,
    fees: override.fees ?? (await floor(lot, lot.next_nonce)),
  }, { deposit: YOCTO });
}

export async function seal(contract: string, signer: string, id: number, fees?: Fees) {
  const lot = await mustLot(contract, id);
  return call(signer, contract, "seal", { id, fees: fees ?? await floor(lot, lot.next_nonce) }, { deposit: YOCTO });
}

export async function rebump(contract: string, signer: string, id: number, nonce: number) {
  const lot = await mustLot(contract, id);
  return call(signer, contract, "rebump", { id, nonce, fees: await floor(lot, nonce) }, { deposit: YOCTO });
}

export async function rescue(contract: string, signer: string, id: number) {
  const lot = await mustLot(contract, id);
  return call(signer, contract, "rescue", { id, fees: await floor(lot, lot.next_nonce + 1) }, { deposit: YOCTO });
}

export type RelayStep =
  | { kind: "topup"; seq: number; tx: Hex }
  | { kind: "broadcast"; seq: number; result: base.Broadcast }
  | { kind: "mined"; seq: number; tx: Hex; block: bigint; status: "success" | "reverted" }
  | { kind: "prove"; seq: number; outcome: CallOutcome<boolean> };

/**
 * Broadcasts the selected issued txs, waits for one to mine with status 1, waits for the contract's
 * finality, then proves the highest such nonce. Safe to rerun: already-known and already-consumed
 * txs are not errors. A reverted tx can never be proven; `reverted` tells the caller to `rescue`.
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

  const seen = new Set<number>();
  let mined: { issued: Issued; block: bigint } | null = null;
  let reverted = false;
  const highestNonce = Math.max(lot.next_nonce, ...lot.issued.map((i) => i.nonce));
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    for (const i of lot.issued.filter((i) => i.tx_hash && !seen.has(i.seq))) {
      const r = await base.receipt(i.tx_hash as Hex);
      if (!r) continue;
      seen.add(i.seq);
      steps.push({ kind: "mined", seq: i.seq, tx: r.transactionHash, block: r.blockNumber, status: r.status });
      if (r.status === "reverted") reverted = true;
      else if (!mined || i.nonce > mined.issued.nonce) mined = { issued: i, block: r.blockNumber };
    }
    if (mined?.issued.nonce === highestNonce) break;
    if (reverted && lot.issued.filter((i) => i.nonce === highestNonce).some((i) => seen.has(i.seq))) break;
    await Bun.sleep(3_000);
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

export async function list(contract: string, owner: string, id: number, priceYocto: bigint) {
  return call(owner, contract, "list", { id, price: priceYocto.toString() });
}

/** Buys at the listed price, bound to the lot version the buyer just read. */
export async function buy(contract: string, buyer: string, id: number) {
  const lot = await mustLot(contract, id);
  if (!lot.listing) throw new Error(`lot ${id} is not listed`);
  return call(buyer, contract, "buy", { id, version: lot.version }, { deposit: BigInt(lot.listing.price) });
}

export async function withdraw(contract: string, account: string) {
  return call(account, contract, "withdraw_proceeds", {});
}
