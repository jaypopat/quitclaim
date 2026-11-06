import { PublicKey } from "near-api-js";
import { bytesToHex, type Address } from "viem";
import { publicKeyToAddress } from "viem/accounts";
import { config } from "./config.ts";
import { nearView } from "./near.ts";

/** `secp256k1:<base58>` from MPC's `derived_public_key` → EVM address. */
export function evmAddressFromNearKey(nearKey: string): Address {
  if (!nearKey.startsWith("secp256k1:"))
    throw new Error(`not a secp256k1 key: ${nearKey}`);
  return publicKeyToAddress(
    `0x04${bytesToHex(PublicKey.fromString(nearKey).data).slice(2)}`,
  );
}

/** The lot address depends on the lot contract account and the path. Moving either orphans the lot. */
export async function fetchLotAddress(
  lotContract: string,
  path: string,
): Promise<Address> {
  const key = await nearView<string>(
    config.near.mpcSigner,
    "derived_public_key",
    { path, predecessor: lotContract, domain_id: config.near.signDomain },
  );
  return evmAddressFromNearKey(key);
}
