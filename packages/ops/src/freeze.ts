/**
 * Deletes every full-access key on LOT_CONTRACT, so nobody can redeploy or drain it again. Run it
 * once, last, on the final contract. It refuses unless the newest report of every e2e scenario for
 * that contract passed at Safe finality against the code deployed now.
 *
 *   bun run freeze
 */
import { Glob } from "bun";
import { PublicKey, actions } from "near-api-js";
import { scenarioNames } from "./e2e/names.ts";
import { env } from "./env.ts";
import { account, codeHash, fullAccessKeys, getFinality, nearTxUrl } from "./near.ts";

const contractId = env.lotContract();

const reportsDir = new URL("../../../reports/", import.meta.url).pathname;
const hash = await codeHash(contractId);
const finality = await getFinality(contractId);
if (finality !== "Safe") throw new Error(`${contractId} runs at ${finality} finality; freeze only a Safe contract`);

const evidence: string[] = [];
for (const scenario of scenarioNames) {
  const files = [...new Glob(`e2e-${scenario}-*.md`).scanSync(reportsDir)].sort();
  let found = false;
  for (const file of files.reverse()) {
    const text = await Bun.file(reportsDir + file).text();
    if (!text.includes(`contract: \`${contractId}\``)) continue;
    if (!text.includes("Result: **PASS**")) throw new Error(`newest ${scenario} report for ${contractId} failed: ${file}`);
    if (!text.includes(`finality **Safe**, code hash \`${hash}\``)) throw new Error(`${file} ran against other code or finality than ${hash} at Safe`);
    evidence.push(`- ${scenario}: \`reports/${file}\``);
    found = true;
    break;
  }
  if (!found) throw new Error(`no ${scenario} report for ${contractId}; run bun run e2e first`);
}

const keys = await fullAccessKeys(contractId);
if (keys.length === 0) throw new Error(`${contractId} has no full-access keys; already frozen`);

console.log(`${contractId}, code hash ${hash}, Safe finality`);
console.log(evidence.join("\n"));
console.log(`\nThis deletes ${keys.length} full-access key(s):\n${keys.map((k) => `  ${k}`).join("\n")}`);
console.log("Nobody, including you, can redeploy, upgrade or delete this contract afterwards. It cannot be undone.");
if (prompt(`Type ${contractId} to freeze it:`) !== contractId) {
  console.error("not confirmed; nothing changed");
  process.exit(1);
}

const res = await (await account(contractId)).signAndSendTransaction({
  receiverId: contractId,
  actions: keys.map((k) => actions.deleteKey(PublicKey.fromString(k))),
  waitUntil: "FINAL",
});
const tx = nearTxUrl(res.transaction.hash);
const left = await fullAccessKeys(contractId);
if (left.length) throw new Error(`full-access keys remain after ${tx}: ${left.join(", ")}`);

await Bun.write(
  `${reportsDir}freeze-${contractId}.md`,
  [
    `# Freeze ${contractId}`,
    "",
    `- ${new Date().toISOString()}: deleted every full-access key in ${tx}`,
    `- code hash \`${hash}\`, finality Safe`,
    `- the account now has no full-access keys, so its code can never change`,
    "",
    "## Passing e2e reports against this code",
    "",
    ...evidence,
    "",
  ].join("\n"),
);
console.log(`frozen: ${tx}`);
