/** JSON shapes returned by `contracts/lot` views. Keep in sync with `contracts/lot/src/types.rs`. */
export type LotState = "Minting" | "Active" | "Sealing" | "Clean";
export type Kind = { Claim: { to: string } } | "Burn";
export type Fees = { max_fee: string; max_prio: string };

export type Issued = {
  seq: number;
  nonce: number;
  kind: Kind;
  gas_limit: number;
  fees: Fees;
  tx_hash: string | null;
  raw_tx: string | null;
};

export type Lot = {
  owner: string;
  issuer: string;
  path: string;
  address: string | null;
  vesting: string;
  state: LotState;
  version: number;
  next_nonce: number;
  issued: Issued[];
  next_seq: number;
  sign_in_flight: boolean;
  prove_in_flight: boolean;
};

export type Finality = "Latest" | "Safe" | "Finalized";

export const isBurn = (i: Issued) => i.kind === "Burn";

/** Fees for a new tx at `nonce`: at least `floor`, and >=10% over everything already issued there. */
export function nextFees(issued: Issued[], nonce: number, floor: { maxFee: bigint; maxPrio: bigint }): Fees {
  const atNonce = issued.filter((i) => i.nonce === nonce);
  const bump = (v: bigint) => (v * 11n) / 10n + 1n;
  const prevFee = atNonce.reduce((m, i) => (BigInt(i.fees.max_fee) > m ? BigInt(i.fees.max_fee) : m), 0n);
  const prevPrio = atNonce.reduce((m, i) => (BigInt(i.fees.max_prio) > m ? BigInt(i.fees.max_prio) : m), 0n);
  let maxPrio = atNonce.length ? (bump(prevPrio) > floor.maxPrio ? bump(prevPrio) : floor.maxPrio) : floor.maxPrio;
  let maxFee = atNonce.length ? (bump(prevFee) > floor.maxFee ? bump(prevFee) : floor.maxFee) : floor.maxFee;
  if (maxFee < maxPrio) maxFee = maxPrio;
  return { max_fee: maxFee.toString(), max_prio: maxPrio.toString() };
}
