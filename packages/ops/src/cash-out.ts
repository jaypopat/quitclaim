/**
 * Cashes a lot's USDC out for Tidepool test wNEAR (no value) on NEAR through NEAR Intents
 * (`intents.ts`). Only the title owner of an Active, unleased lot with nothing issued may run it,
 * because a refund returns the tokens to the lot and would not restore a lessee's spent budget. The
 * lot signs one transfer of exactly the quoted `amountIn` to the deposit address. This script
 * broadcasts it, checks its Transfer log, hands its hash to 1Click, proves its nonce and waits for
 * the swap. `reports/cash-out-<time>.json` records the operation before signing and after each step.
 *
 *   bun run cash-out <lot-id> <owner-account> [amount in USDC]
 */
import {
  erc20Abi,
  formatUnits,
  isAddressEqual,
  keccak256,
  parseEventLogs,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import type { GetExecutionStatusResponse } from "@defuse-protocol/one-click-sdk-typescript";
import { config, nearView } from "@quitclaim/shared";
import * as base from "./base.ts";
import { env } from "./env.ts";
import * as intents from "./intents.ts";
import { settle, type SettleStep } from "./keeper.ts";
import { logger } from "./logger.ts";
import { mustLot, pullSource, requestTransfer } from "./lot.ts";

const [idArg, owner, amountArg] = Bun.argv.slice(2);
if (!idArg || !owner) {
  logger.error(
    "usage: bun run cash-out <lot-id> <owner-account> [amount in USDC]",
  );
  process.exit(1);
}
const contract = env.lotContract();
const id = Number(idArg);
const startedAt = new Date().toISOString();
const file = new URL(
  `../../../reports/cash-out-${startedAt.replaceAll(":", "-")}.json`,
  import.meta.url,
);
const SWAP_WAIT_MS = 10 * 60_000;

const wnearOf = async (account: string) =>
  BigInt(
    await nearView<string>(config.intents.wnear, "ft_balance_of", {
      account_id: account,
    }),
  );
const usdc = (units: bigint) => `${formatUnits(units, 6)} USDC`;
const wnear = (units: bigint) =>
  `${formatUnits(units, 24)} Tidepool test wNEAR (no value)`;

const lot = await mustLot(contract, id);
if (lot.owner !== owner)
  throw new Error(
    `${owner} does not hold lot ${id}'s title; ${lot.owner} does`,
  );
if (lot.lease)
  throw new Error(
    `lot ${id} is leased; a refund would return tokens to the lot without restoring the lessee's budget`,
  );
if (lot.state !== "Active" || lot.issued.length > 0)
  throw new Error(
    `lot ${id} must be Active with nothing issued, not ${lot.state} with ${lot.issued.length} issued`,
  );
if (!isAddressEqual(lot.token as Address, config.evm.token))
  throw new Error(
    `lot ${id} holds ${lot.token}, not the USDC Tidepool bridges`,
  );
const address = lot.address as Address;

const pull = await pullSource(lot);
const requested = amountArg
  ? parseUnits(amountArg, 6)
  : await base.tokenBalance(config.evm.token, address);
if (requested === 0n) throw new Error(`lot ${id} holds no USDC to cash out`);
const wnearBefore = await wnearOf(owner);
const quoted = await intents.quote(requested, address, owner);
const amount = BigInt(quoted.quote.amountIn);

const op: {
  startedAt: string;
  contract: string;
  lot: { id: number; version: number; address: Address };
  pull: Hex | null;
  recipient: string;
  refundTo: Address;
  amount: string;
  depositAddress: Address;
  deadline: string;
  quote: typeof quoted;
  wnearBefore: string;
  issued?: { seq: number; nonce: number; hash: Hex; request: string };
  deposit?: { status: string; transferLogged: boolean; url: string };
  proof?: { seq: number; proven: boolean; url?: string; error?: string };
  swap?: GetExecutionStatusResponse;
  wnearAfter?: string;
  error?: string;
} = {
  startedAt,
  contract,
  lot: { id, version: lot.version, address },
  pull,
  recipient: owner,
  refundTo: address,
  amount: amount.toString(),
  depositAddress: quoted.quote.depositAddress,
  deadline: quoted.quote.deadline,
  quote: quoted,
  wnearBefore: wnearBefore.toString(),
};
const record = () => Bun.write(file, `${JSON.stringify(op, null, 2)}\n`);
await record();
logger.info({ report: file.pathname }, "Cash-out recorded before signing");

try {
  const req = await requestTransfer(contract, owner, id, op.depositAddress, {
    amount,
  });
  if (!req.ok) throw new Error(`request_transfer refused: ${req.error}`);
  if (!req.value)
    throw new Error(`request_transfer returned no signed tx: ${req.url}`);
  const raw = req.value as Hex;
  const hash = keccak256(raw);
  const pinned = (await mustLot(contract, id)).issued.find(
    (i) => i.tx_hash === hash,
  );
  if (!pinned) throw new Error(`lot ${id} has no issued tx ${hash}`);
  op.issued = { seq: pinned.seq, nonce: pinned.nonce, hash, request: req.url };
  await record();

  await base.ensureBalance(address, await base.maxCost(raw));
  const sent = await base.broadcast(raw);
  if (!("hash" in sent)) throw new Error(`broadcast failed: ${sent.message}`);
  await intents.submitDeposit(hash, op.depositAddress);
  const receipt = await base.pub.waitForTransactionReceipt({ hash });
  const transferLogged = parseEventLogs({
    abi: erc20Abi,
    eventName: "Transfer",
    logs: receipt.logs,
  }).some(
    (l) =>
      isAddressEqual(l.address, config.evm.token) &&
      isAddressEqual(l.args.from, address) &&
      isAddressEqual(l.args.to, op.depositAddress) &&
      l.args.value === amount,
  );
  op.deposit = {
    status: receipt.status,
    transferLogged,
    url: base.txUrl(hash),
  };
  await record();
  if (receipt.status !== "success" || !transferLogged)
    throw new Error(
      `deposit ${op.deposit.url} did not move ${usdc(amount)} from the lot to ${op.depositAddress}`,
    );

  op.proof = await settle(contract, env.keeper(), id).then(
    ({ steps }) => {
      const step = steps.find(
        (s): s is Extract<SettleStep, { kind: "prove" }> =>
          s.kind === "prove" && s.seq === pinned.seq,
      );
      return {
        seq: pinned.seq,
        proven: !!step?.outcome.ok && step.outcome.value === true,
        url: step?.outcome.url,
      };
    },
    (e: Error) => ({ seq: pinned.seq, proven: false, error: e.message }),
  );
  await record();

  const swap = await intents.awaitSwap(op.depositAddress, SWAP_WAIT_MS);
  const wnearAfter = await wnearOf(owner);
  op.swap = swap;
  op.wnearAfter = wnearAfter.toString();
  await record();

  const delivered =
    swap.status === intents.Status.SUCCESS && wnearAfter > wnearBefore;
  const payout = swap.swapDetails.destinationChainTxHashes
    .map((t) => t.explorerUrl)
    .join(" ");
  const swapLine =
    swap.status === intents.Status.SUCCESS
      ? `swap delivered: ${delivered ? "yes" : "no"}, SUCCESS, ${owner} holds ${wnear(wnearAfter)}, up from ${formatUnits(wnearBefore, 24)} ${payout}`
      : swap.status === intents.Status.REFUNDED ||
          swap.status === intents.Status.FAILED
        ? `swap delivered: no, ${swap.status} ${swap.swapDetails.refundReason ?? ""}`
        : `swap delivered: unresolved, still ${swap.status} after ${SWAP_WAIT_MS / 60_000} min; do not retry, check ${config.intents.apiBase}/v0/status?depositAddress=${op.depositAddress}`;
  console.log(
    [
      `deposit mined: yes, ${usdc(amount)} from lot ${id} to ${op.depositAddress} ${op.deposit.url}`,
      `nonce proven: ${op.proof.proven ? "yes" : "no"}, nonce ${pinned.nonce} (seq ${pinned.seq}) ${op.proof.url ?? `${op.proof.error}; bun run keeper proves it later`}`,
      swapLine,
      `record: ${file.pathname}`,
    ].join("\n"),
  );
  process.exit(op.proof.proven && delivered ? 0 : 1);
} catch (e) {
  op.error = e instanceof Error ? e.message : String(e);
  await record();
  throw e;
}
