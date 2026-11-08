/**
 * Puts three real test-USDC lots on the market: one listed for sale, one offered for lease, one held.
 * Each is a fresh 5 USDC stream over 30 days from the funder, whose faucet mints 100 an hour.
 *
 *   bun run seed
 */
import { nearToYocto } from "near-api-js";
import { env } from "@quitclaim/sdk/env.ts";
import { list, offerLease, provision, seal } from "@quitclaim/sdk/lot.ts";
import { logger } from "@quitclaim/sdk/logger.ts";
import type { CallOutcome } from "@quitclaim/sdk/near.ts";

const contract = env.lotContract();
const owner = env.alice();
const minter = env.minter();
const stamp = Date.now();

function must<T>(step: string, outcome: CallOutcome<T>) {
  if (!outcome.ok) throw new Error(`${step} failed: ${outcome.error}`);
  return outcome;
}

/** A fresh lot has nothing issued, so one seal makes it Clean, which listing and leasing need. */
const offers = {
  sale: (id: number) => list(contract, owner, id, nearToYocto("2")),
  lease: (id: number) =>
    offerLease(
      contract,
      owner,
      id,
      nearToYocto("0.5"),
      Date.now() + 7 * 86_400_000,
    ),
  held: null,
};

try {
  for (const [kind, offer] of Object.entries(offers)) {
    const lot = await provision({
      contract,
      name: `seed-${kind}-${stamp}`,
      owner,
      minter,
      durationSec: 30 * 86_400,
    });
    if (offer) {
      must("seal", await seal(contract, owner, lot.id));
      must(kind, await offer(lot.id));
    }
    logger.info(
      { lot: lot.id, address: lot.address, kind, mint: lot.mint.url },
      `seeded lot ${lot.id}`,
    );
  }
} catch (error) {
  logger.error({ err: error, command: "seed" }, "FAIL seed");
  process.exitCode = 1;
}
