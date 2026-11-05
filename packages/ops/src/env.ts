import type { Hex } from "viem";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (see .env.example)`);
  return v;
}

export const env = {
  funderKey: () => need("FUNDER_PK") as Hex,
  lotContract: () => need("LOT_CONTRACT"),
  admin: () => need("ADMIN_ACCOUNT"),
  credentialsDir: process.env.NEAR_CREDENTIALS_DIR ?? `${process.env.HOME}/.near-credentials/testnet`,
};
