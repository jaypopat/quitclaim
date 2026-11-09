/**
 * Puts six realistic test-USDC lots on the market, each a different stage of a vesting grant:
 *
 *   bun run seed
 *
 * The streams start in the past where the story needs it, so a lot can be a year into a four-year
 * vest with its cliff behind it. Together they spend 100 USDC, one hourly faucet drip on top of
 * whatever the funder already holds. Prices stay a few NEAR so a judge with a fresh testnet wallet
 * can buy or lease one.
 */
import { nearToYocto } from "near-api-js";
import type { Address } from "viem";
import { env } from "@quitclaim/sdk/env.ts";
import {
  buy,
  list,
  mustLot,
  offerLease,
  provision,
  pullSource,
  requestTransfer,
  seal,
  takeLease,
} from "@quitclaim/sdk/lot.ts";
import { logger } from "@quitclaim/sdk/logger.ts";
import type { CallOutcome } from "@quitclaim/sdk/near.ts";
import type { Timeline } from "@quitclaim/sdk/sablier.ts";
import { settle } from "@quitclaim/sdk/settle.ts";

const contract = env.lotContract();
const alice = env.alice();
const bob = env.bob();
const carol = env.carol();
const minter = env.minter();
const keeper = env.keeper();
const aliceEvm: Address = "0x000000000000000000000000000000000000a11c";

const DAY = 86_400;
const MS_DAY = DAY * 1000;
const now = Math.floor(Date.now() / 1000);
const usdc = (n: number) => BigInt(n) * 10n ** 6n;
const stamp = Date.now().toString(36);

function must<T>(step: string, outcome: CallOutcome<T>) {
  if (!outcome.ok) throw new Error(`${step} failed: ${outcome.error}`);
  return outcome;
}

/** Seal, then let the keeper burn and prove anything still outstanding, until the lot is Clean. */
async function makeClean(controller: string, id: number) {
  must("seal", await seal(contract, controller, id));
  if ((await mustLot(contract, id)).state !== "Clean")
    await settle(contract, keeper, id);
  const lot = await mustLot(contract, id);
  if (lot.state !== "Clean")
    throw new Error(`lot ${id} is ${lot.state} after settling`);
}

type Scenario = {
  name: string;
  story: string;
  total: bigint;
  days: number;
  timeline: Timeline;
  /** Puts the fresh lot into its state; the last call's outcome, if any, must succeed. */
  stage: (id: number) => Promise<CallOutcome<unknown> | null>;
};

const SCENARIOS: Scenario[] = [
  {
    name: "eng-4y-cliff",
    story:
      "Engineer, 14 months into a 4-year grant with a 1-year cliff. Cashed out once, now selling the rest.",
    total: usdc(30),
    days: 4 * 365,
    timeline: {
      startSec: now - 425 * DAY,
      cliffSec: now - 60 * DAY,
      cliffUnlock: usdc(7),
    },
    stage: async (id) => {
      await pullSource(await mustLot(contract, id));
      must("withdraw", await requestTransfer(contract, alice, id, aliceEvm));
      await settle(contract, keeper, id);
      await makeClean(alice, id);
      return list(contract, alice, id, nearToYocto("4"));
    },
  },
  {
    name: "advisor-2y",
    story:
      "Advisor, 11 months into a 2-year stream, renting out the next month.",
    total: usdc(20),
    days: 2 * 365,
    timeline: { startSec: now - 335 * DAY },
    stage: async (id) => {
      await makeClean(alice, id);
      return offerLease(
        contract,
        alice,
        id,
        nearToYocto("1"),
        Date.now() + 30 * MS_DAY,
      );
    },
  },
  {
    name: "contractor-1y-leased",
    story:
      "Contractor, 4 months into a year. Carol leased the next two weeks of unlocks.",
    total: usdc(15),
    days: 365,
    timeline: { startSec: now - 120 * DAY },
    stage: async (id) => {
      await makeClean(alice, id);
      must(
        "offer lease",
        await offerLease(
          contract,
          alice,
          id,
          nearToYocto("0.6"),
          Date.now() + 14 * MS_DAY,
        ),
      );
      return takeLease(contract, carol, id);
    },
  },
  {
    name: "seed-round-9m-resale",
    story:
      "A 9-month token unlock Bob bought from Alice and relisted higher. The minter earns royalty on both sales.",
    total: usdc(15),
    days: 270,
    timeline: { startSec: now - 60 * DAY },
    stage: async (id) => {
      await makeClean(alice, id);
      must("list", await list(contract, alice, id, nearToYocto("1")));
      must("buy", await buy(contract, bob, id));
      await makeClean(bob, id);
      return list(contract, bob, id, nearToYocto("1.8"));
    },
  },
  {
    name: "grant-6m-held",
    story: "A 6-month grant that started today. The owner is holding.",
    total: usdc(10),
    days: 180,
    timeline: {},
    stage: async () => null,
  },
  {
    name: "bonus-30d-ending",
    story:
      "A 30-day bonus stream with three days left, listed cheap: most of it is already in the address.",
    total: usdc(10),
    days: 30,
    timeline: { startSec: now - 27 * DAY },
    stage: async (id) => {
      await pullSource(await mustLot(contract, id));
      await makeClean(alice, id);
      return list(contract, alice, id, nearToYocto("0.4"));
    },
  },
];

try {
  for (const scenario of SCENARIOS) {
    const lot = await provision({
      contract,
      name: `${scenario.name}-${stamp}`,
      owner: alice,
      minter,
      total: scenario.total,
      durationSec: scenario.days * DAY,
      timeline: scenario.timeline,
    });
    const staged = await scenario.stage(lot.id);
    if (staged) must(scenario.name, staged);
    logger.info(
      { lot: lot.id, address: lot.address, mint: lot.mint.url },
      `seeded lot ${lot.id}: ${scenario.story}`,
    );
  }
} catch (error) {
  logger.error({ err: error, command: "seed" }, "FAIL seed");
  process.exitCode = 1;
}
