import { base58 } from "@scure/base";
import { getAddress, keccak256, type Address } from "viem";
import { config } from "./config.ts";
import { nearView } from "./rpc.ts";

/** `secp256k1:<base58 of 64-byte uncompressed key without 0x04>` → EVM address. */
export function evmAddressFromNearKey(nearKey: string): Address {
  const [curve, encoded] = nearKey.split(":");
  if (curve !== "secp256k1" || !encoded) throw new Error(`not a secp256k1 key: ${nearKey}`);
  const raw = base58.decode(encoded);
  if (raw.length !== 64) throw new Error(`expected 64-byte key, got ${raw.length}`);
  return getAddress(`0x${keccak256(raw).slice(26)}`);
}

/** The lot address depends on the lot contract account and the path. Moving either orphans the lot. */
export async function fetchLotAddress(lotContract: string, path: string): Promise<Address> {
  const key = await nearView<string>(config.near.mpcSigner, "derived_public_key", { path, predecessor: lotContract, domain_id: config.near.signDomain }, "final");
  return evmAddressFromNearKey(key);
}
