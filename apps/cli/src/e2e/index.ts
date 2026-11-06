/**
 * End-to-end adversarial suite against testnet. Each scenario provisions fresh lots, asserts every
 * step the security model promises, and writes `reports/e2e-<scenario>-<time>.md`.
 *
 *   bun run e2e                 all scenarios
 *   bun run e2e handover        one scenario (minting, handover, recovery, lease)
 */
import { contract } from "./context.ts";
import { logger } from "@quitclaim/sdk/logger.ts";
import { scenarioNames, type ScenarioName } from "./names.ts";
import { Run } from "./report.ts";
import { scenarios } from "./scenarios.ts";

const isScenario = (name: string): name is ScenarioName =>
  scenarioNames.some((scenario) => scenario === name);
const args = Bun.argv.slice(2);
const unknown = args.filter((name) => !isScenario(name));
if (unknown.length) {
  logger.error({ unknown, known: scenarioNames }, "Unknown e2e scenario");
  process.exit(1);
}

const requested = args.filter(isScenario);
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
