import type { Hex } from "viem";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (see .env.example)`);
  return v;
}

export const env = {
  funderKey: () => need("FUNDER_PK") as Hex,
  lotContract: () => need("LOT_CONTRACT"),
  /** Parent account for `deploy-lot`; it has no power over deployed contracts. */
  deployer: () => need("DEPLOYER_ACCOUNT"),
  alice: () => need("ALICE_ACCOUNT"),
  bob: () => need("BOB_ACCOUNT"),
  carol: () => need("CAROL_ACCOUNT"),
  minter: () => need("MINTER_ACCOUNT"),
  keeper: () => need("KEEPER_ACCOUNT"),
  credentialsDir: `${process.env.HOME}/.near-credentials/testnet`,
};
