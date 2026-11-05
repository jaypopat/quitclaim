/**
 * Creates `<prefix>.<DEPLOYER_ACCOUNT>` and deploys the lot contract to it.
 * Every lot address derives from this account: never redeploy lots to a different one.
 *
 *   bun run deploy-lot <prefix> [Latest|Safe|Finalized]
 */
import { Account, KeyPair, actions, nearToYocto, teraToGas, type KeyPairString } from "near-api-js";
import { config } from "@quitclaim/shared";
import { account, provider } from "./near.ts";
import { env } from "./env.ts";
import { LOCKUP } from "./sablier.ts";

const [prefix, finality = "Safe"] = Bun.argv.slice(2);
if (!prefix || !["Latest", "Safe", "Finalized"].includes(finality)) {
  console.error("usage: bun run deploy-lot <prefix> [Latest|Safe|Finalized]");
  process.exit(1);
}
const deployer = env.deployer();
const contractId = `${prefix}.${deployer}`;
const wasm = await Bun.file(new URL("../../../target/near/quitclaim_lot/quitclaim_lot.wasm", import.meta.url)).bytes();

const key = KeyPair.fromRandom("ed25519");
await (await account(deployer)).createSubAccount({ accountOrPrefix: contractId, publicKey: key.getPublicKey().toString(), nearToTransfer: nearToYocto("5") });
await Bun.write(`${env.credentialsDir}/${contractId}.json`, JSON.stringify({ account_id: contractId, public_key: key.getPublicKey().toString(), private_key: key.toString() }));

const contract = new Account(contractId, provider(), key.toString() as KeyPairString);
const res = await contract.signAndSendTransaction({
  receiverId: contractId,
  actions: [
    actions.deployContract(wasm),
    actions.functionCall("new", { signer: config.near.mpcSigner, lockup: LOCKUP, finality }, teraToGas(30), 0n),
  ],
  waitUntil: "FINAL",
});
console.log(`deployed ${contractId} (finality ${finality}): https://testnet.nearblocks.io/txns/${res.transaction.hash}`);
console.log(`set LOT_CONTRACT=${contractId} in .env`);
