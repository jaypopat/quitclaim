/**
 * End-to-end adversarial suite against testnet. Each scenario provisions fresh lots, asserts every
 * step the security model promises, and writes `reports/e2e-<scenario>-<time>.md`.
 *
 *   bun run e2e                 all scenarios
 *   bun run e2e handover        one scenario (minting, handover, recovery, lease)
 */
import { contract } from "./context.ts";
import { scenarioNames, type ScenarioName } from "./names.ts";
import { Run } from "./report.ts";
import { scenarios } from "./scenarios.ts";

const requested = Bun.argv.slice(2) as ScenarioName[];
const unknown = requested.filter((n) => !scenarioNames.includes(n));
if (unknown.length) {
  console.error(`unknown scenario: ${unknown.join(", ")}. Known: ${scenarioNames.join(", ")}`);
  process.exit(1);
}

let allPass = true;
for (const name of requested.length ? requested : scenarioNames) {
  const run = await Run.start(name, contract);
  let error: unknown;
  try {
    await scenarios[name](run);
  } catch (e) {
    error = e;
  }
  allPass = (await run.write(error)) && allPass;
}
process.exit(allPass ? 0 : 1);
