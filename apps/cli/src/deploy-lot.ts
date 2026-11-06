/**
 * Creates `<account>` (a sub-account of DEPLOYER_ACCOUNT, or a top-level `<name>.testnet`) and
 * deploys the lot contract to it. Every lot address derives from this account: never redeploy lots
 * to a different one.
 *
 *   bun run deploy-lot <account> [Latest|Safe]
 */
import {
  Account,
  KeyPair,
  KeyPairSigner,
  actions,
  nearToYocto,
  teraToGas,
} from "near-api-js";
import { config, nearProvider } from "@quitclaim/shared";
import { account, nearTxUrl } from "@quitclaim/sdk/near.ts";
import { env } from "@quitclaim/sdk/env.ts";
import { logger } from "@quitclaim/sdk/logger.ts";
import { LOCKUP } from "@quitclaim/sdk/sablier.ts";

const [contractId, finality = "Safe"] = Bun.argv.slice(2);
if (!contractId || !["Latest", "Safe"].includes(finality)) {
  logger.error("usage: bun run deploy-lot <account> [Latest|Safe]");
  process.exit(1);
}
const wasm = await Bun.file(
  new URL(
    "../../../target/near/quitclaim_lot/quitclaim_lot.wasm",
    import.meta.url,
  ),
).bytes();

const key = KeyPair.fromRandom("ed25519");
await (
  await account(env.deployer())
).createAccount({
  newAccountId: contractId,
  publicKey: key.getPublicKey().toString(),
  nearToTransfer: nearToYocto("5"),
});
await Bun.write(
  `${env.credentialsDir}/${contractId}.json`,
  JSON.stringify({
    account_id: contractId,
    public_key: key.getPublicKey().toString(),
    private_key: key.toString(),
  }),
);

const contract = new Account(contractId, nearProvider, new KeyPairSigner(key));
const res = await contract.signAndSendTransaction({
  receiverId: contractId,
  actions: [
    actions.deployContract(wasm),
    actions.functionCall(
      "new",
      { signer: config.near.mpcSigner, lockup: LOCKUP, finality },
      teraToGas(30),
      0n,
    ),
  ],
  waitUntil: "FINAL",
});
logger.info(
  {
    contract: contractId,
    finality,
    transaction: nearTxUrl(res.transaction.hash),
  },
  "Contract deployed",
);
console.log(`set LOT_CONTRACT=${contractId} in .env`);
