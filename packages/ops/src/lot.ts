import type { Address, Hex } from "viem";
import { fetchLotAddress, nextFees, type Fees, type Lot, type LotCalls } from "@quitclaim/shared";
import * as base from "./base.ts";
import * as sablier from "./sablier.ts";
import { call, getFinality, getLot, view, type CallOutcome } from "./near.ts";
import { env } from "./env.ts";

const YOCTO = 1n;
/** Covers the lot's storage at mint; the contract refunds the excess, and all of it on rollback. */
export const MINT_DEPOSIT = 50_000_000_000_000_000_000_000n;

export type Provisioned = {
  id: number;
  address: Address;
  token: Address;
  streamId: bigint;
  streamTx: Hex;
  fundTx: Hex;
  title: sablier.TitleSearch;
  mint: CallOutcome<LotCalls["mint_proven"]["result"]>;
};

/**
 * Lot provisioning, with no trusted admin: derive the lot address in the minter's namespace
 * (`<minter>/<name>`), create a non-cancelable, non-transferable Sablier stream paying it, fund gas,
 * wait for the contract's finality, then the minter mints. The contract decodes the stream's creation
 * log and has MPC attest it before the title exists.
 */
export async function provision(opts: {
  contract: string;
  name: string;
  owner: string;
  minter: string;
  royaltyBps?: number;
  durationSec?: number;
  total?: bigint;
  gasFund?: bigint;
}): Promise<Provisioned> {
  const token = env.token();
  const address = await fetchLotAddress(opts.contract, `${opts.minter}/${opts.name}`);
  const stream = await sablier.createStream(address, token, opts.total ?? 1_000n * 10n ** 18n, opts.durationSec ?? 3_600);
  const title = await sablier.titleSearch(stream.id, address, token);
  if (!title.clean) throw new Error(`stream ${stream.id} fails title search: ${JSON.stringify(title)}`);
  const fundTx = await base.fund(address, opts.gasFund ?? 2_000_000_000_000_000n);
  await base.waitFinality(stream.block, await getFinality(opts.contract));
  const mint = await call(opts.minter, opts.contract, "mint_proven", {
    name: opts.name,
    owner_id: opts.owner,
    royalty_bps: opts.royaltyBps ?? 250,
    log: stream.log,
  }, { deposit: MINT_DEPOSIT });
  if (!mint.ok || !mint.value) throw new Error(`mint failed: ${mint.ok ? "rolled back (see contract logs)" : mint.error}`);
  if (mint.value.address.toLowerCase() !== address.toLowerCase()) {
    throw new Error(`contract derived ${mint.value.address}, expected ${address}`);
  }
  return { id: mint.value.id, address, token, streamId: stream.id, streamTx: stream.tx, fundTx, title, mint };
}

/** Moves whatever the lot's stream has vested into the lot. Anyone may do this. */
export async function pullSource(lot: Lot) {
  return sablier.pull(BigInt(lot.source.id), lot.address as Address);
}

/** The lot's whole position in token units: still in the stream plus already held at the address. */
export async function position(lot: Lot) {
  const held = await base.tokenBalance(lot.token as Address, lot.address as Address);
  const locked = await sablier.remaining(BigInt(lot.source.id));
  return { held, locked, total: held + locked };
}

export async function floor(lot: Lot, nonce: number): Promise<Fees> {
  const f = await base.floorFees();
  return nextFees(lot.issued, nonce, { maxFee: f.maxFee, maxPrio: f.maxPrio });
}

export const mustLot = async (contract: string, id: number) => {
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

/** The controller lists a Clean lot: the lease while one exists, else the title. */
export async function list(contract: string, controller: string, id: number, priceYocto: bigint) {
  return call(controller, contract, "list", { id, price: priceYocto.toString() });
}

/** Buys whatever is listed (title or lease) at its price, bound to the lot version the buyer just read. */
export async function buy(contract: string, buyer: string, id: number) {
  const lot = await mustLot(contract, id);
  if (!lot.listing) throw new Error(`lot ${id} is not listed`);
  return call(buyer, contract, "buy", { id, version: lot.version }, { deposit: BigInt(lot.listing.price) });
}

export async function withdraw(contract: string, account: string) {
  return call(account, contract, "withdraw_proceeds", {});
}

/** The title owner offers a Clean lot for lease until `endsAtMs`. */
export async function offerLease(contract: string, owner: string, id: number, priceYocto: bigint, endsAtMs: number) {
  return call(owner, contract, "offer_lease", { id, price: priceYocto.toString(), ends_at_ms: endsAtMs });
}

/** Takes the lease offer at its price, bound to the lot version the lessee just read. */
export async function takeLease(contract: string, lessee: string, id: number) {
  const lot = await mustLot(contract, id);
  if (!lot.lease_offer) throw new Error(`lot ${id} has no lease offer`);
  return call(lessee, contract, "take_lease", { id, version: lot.version }, { deposit: BigInt(lot.lease_offer.price) });
}

export async function surrenderLease(contract: string, holder: string, id: number) {
  return call(holder, contract, "surrender_lease", { id });
}

export async function endLease(contract: string, signer: string, id: number) {
  return call(signer, contract, "end_lease", { id });
}

/** What the lease holder may still move out right now, in token units. */
export async function leaseLeft(contract: string, id: number) {
  const budget = await view(contract, "lease_budget", { id });
  return BigInt(budget.allowed) - BigInt(budget.committed);
}

/** By this machine's clock; the contract decides by NEAR block time. */
export const leaseRunOut = (lot: Lot) => !!lot.lease && Date.now() >= lot.lease.ends_at_ms;
