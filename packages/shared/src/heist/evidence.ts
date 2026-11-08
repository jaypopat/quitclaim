import {
  isAddress,
  isHex,
  type Address,
  type Hex,
  type TransactionSerializedEIP1559,
} from "viem";
import { config } from "../config.ts";
import { baseDecode } from "near-api-js";
import { z } from "zod";

const address = z.custom<Address>(
  (v) => typeof v === "string" && isAddress(v, { strict: false }),
  "must be an EVM address",
);
const evmHash = z.custom<Hex>(
  (v) => typeof v === "string" && isHex(v, { strict: true }) && v.length === 66,
  "must be a 32-byte EVM hash",
);
const nearHash = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/)
  .refine((h) => baseDecode(h).length === 32, "must be a NEAR hash");
const account = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
export const retainedTx = z.custom<TransactionSerializedEIP1559>(
  (v) => typeof v === "string" && /^0x02(?:[0-9a-f]{2})+$/i.test(v),
  "must be serialized EIP-1559 bytes",
);
const person = z.object({ near: account, evm: address });
const nearRef = z.object({ hash: nearHash, signer: account });

const evidence = z.object({
  version: z.literal(1),
  recordedAt: z.iso.datetime(),
  report: z.string().min(1),
  contract: account,
  codeHash: nearHash,
  finality: z.enum(["Latest", "Safe", "Finalized"]),
  recordedFullAccessKeys: z.int().nonnegative().nullable(),
  chainId: z.literal(config.evm.chainId),
  lot: z.object({ id: z.int().nonnegative(), address, token: address }),
  seller: person,
  buyer: person,
  retained: retainedTx,
  consumingTx: evmHash,
  proof: nearRef,
  sale: nearRef,
  buyerWithdrawal: evmHash,
});

export type NearRef = z.infer<typeof nearRef>;
export type HeistEvidence = z.infer<typeof evidence>;
export type HeistRun = Omit<
  HeistEvidence,
  | "version"
  | "recordedAt"
  | "report"
  | "codeHash"
  | "finality"
  | "recordedFullAccessKeys"
>;

export const parseEvidence = (value: unknown) => evidence.parse(value);
