import { expect, test } from "bun:test";
import { evmAddressFromNearKey } from "./address.ts";

test("derives the lot-0 address observed on Sepolia and Base", () => {
  const key =
    "secp256k1:285rgch9NN8VEHAUXSYuQbxoSPMrMRRhtuvZ1pE62gwaPi9B5HEE6VtqMRxMrTDxgFCPYr1gnCNJq5J6x6LTxgLH";
  expect(evmAddressFromNearKey(key)).toBe(
    "0x40b30406F81ed1C2c4Ae3362b8477509Fc7Cee39",
  );
});

test("rejects non-secp256k1 keys", () => {
  expect(() => evmAddressFromNearKey("ed25519:abc")).toThrow(
    "not a secp256k1 key",
  );
});
