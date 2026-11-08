/**
 * Verifies a published handover with public RPCs and replays the seller's retained withdrawal.
 *
 *   bun run heist [evidence.json]    defaults to reports/heist.json
 */
import { parseEvidence } from "@quitclaim/shared/heist/evidence.ts";
import { observe, replay } from "@quitclaim/shared/heist/observe.ts";
import { verifyHeist } from "@quitclaim/shared/heist/verify.ts";
import { logger } from "@quitclaim/sdk/logger.ts";

try {
  const args = Bun.argv.slice(2);
  if (args.length > 1) throw new Error("usage: bun run heist [evidence.json]");
  const file =
    args[0] ?? new URL("../../../reports/heist.json", import.meta.url).pathname;
  await verifyHeist(parseEvidence(await Bun.file(file).json()), {
    observe,
    replay,
    log: console.log,
  });
} catch (error) {
  logger.error({ err: error, command: "heist" }, "FAIL heist");
  process.exitCode = 1;
}
