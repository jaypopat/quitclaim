import {
  isAddress,
  isHex,
  type Address,
  type Hex,
  type TransactionSerializedEIP1559,
} from "viem";
import { config, type Finality } from "@quitclaim/shared";
import { baseDecode } from "near-api-js";

export type NearRef = { hash: string; signer: string };
export type HeistEvidence = {
  version: 1;
  recordedAt: string;
  report: string;
  contract: string;
  codeHash: string;
  finality: Finality;
  recordedFullAccessKeys: number | null;
  chainId: typeof config.evm.chainId;
  lot: { id: number; address: Address; token: Address };
  seller: { near: string; evm: Address };
  buyer: { near: string; evm: Address };
  retained: TransactionSerializedEIP1559;
  consumingTx: Hex;
  proof: NearRef;
  sale: NearRef;
  buyerWithdrawal: Hex;
};

export type HeistRun = Omit<
  HeistEvidence,
  | "version"
  | "recordedAt"
  | "report"
  | "codeHash"
  | "finality"
  | "recordedFullAccessKeys"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function object(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.length)
    throw new Error(`${label} must be a string`);
  return value;
}

export function natural(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a nonnegative safe integer`);
  return value;
}

function address(value: unknown, label: string): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false }))
    throw new Error(`${label} must be an EVM address`);
  return value;
}

function nearHash(value: unknown, label: string): string {
  const hash = text(value, label);
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(hash) || baseDecode(hash).length !== 32)
    throw new Error(`${label} must be a NEAR hash`);
  return hash;
}

function account(value: unknown, label: string): string {
  const id = text(value, label);
  if (
    id.length < 2 ||
    id.length > 64 ||
    !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id)
  )
    throw new Error(`${label} must be a NEAR account ID`);
  return id;
}

function evmHash(value: unknown, label: string): Hex {
  if (
    typeof value !== "string" ||
    !isHex(value, { strict: true }) ||
    value.length !== 66
  )
    throw new Error(`${label} must be a 32-byte EVM hash`);
  return value;
}

function is1559(value: unknown): value is TransactionSerializedEIP1559 {
  return typeof value === "string" && /^0x02(?:[0-9a-f]{2})+$/i.test(value);
}

export function retainedBytes(value: unknown): TransactionSerializedEIP1559 {
  if (!is1559(value))
    throw new Error("retained must be serialized EIP-1559 bytes");
  return value;
}

function finality(value: unknown): Finality {
  if (value !== "Latest" && value !== "Safe" && value !== "Finalized")
    throw new Error("unsupported finality");
  return value;
}

export function parseEvidence(value: unknown): HeistEvidence {
  const e = object(value, "evidence");
  if (e.version !== 1) throw new Error("unsupported evidence version");
  if (e.chainId !== config.evm.chainId)
    throw new Error(`evidence must use Base Sepolia ${config.evm.chainId}`);
  const lot = object(e.lot, "lot");
  const person = (value: unknown, label: string) => {
    const p = object(value, label);
    return {
      near: account(p.near, `${label}.near`),
      evm: address(p.evm, `${label}.evm`),
    };
  };
  const ref = (value: unknown, label: string): NearRef => {
    const r = object(value, label);
    return {
      hash: nearHash(r.hash, `${label}.hash`),
      signer: account(r.signer, `${label}.signer`),
    };
  };
  const recordedAt = text(e.recordedAt, "recordedAt");
  if (!Number.isFinite(Date.parse(recordedAt)))
    throw new Error("invalid recordedAt");
  return {
    version: 1,
    recordedAt,
    report: text(e.report, "report"),
    contract: account(e.contract, "contract"),
    codeHash: nearHash(e.codeHash, "codeHash"),
    finality: finality(e.finality),
    recordedFullAccessKeys:
      e.recordedFullAccessKeys === null
        ? null
        : natural(e.recordedFullAccessKeys, "recordedFullAccessKeys"),
    chainId: config.evm.chainId,
    lot: {
      id: natural(lot.id, "lot.id"),
      address: address(lot.address, "lot.address"),
      token: address(lot.token, "lot.token"),
    },
    seller: person(e.seller, "seller"),
    buyer: person(e.buyer, "buyer"),
    retained: retainedBytes(e.retained),
    consumingTx: evmHash(e.consumingTx, "consumingTx"),
    proof: ref(e.proof, "proof"),
    sale: ref(e.sale, "sale"),
    buyerWithdrawal: evmHash(e.buyerWithdrawal, "buyerWithdrawal"),
  };
}
