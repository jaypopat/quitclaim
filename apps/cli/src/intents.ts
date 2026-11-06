/**
 * NEAR Intents through Tidepool, a community-run, 1Click-compatible sandbox on the NEAR Intents
 * verifier on testnet, using the official 1Click SDK. A swap from Base starts with an ERC-20 transfer
 * of `amountIn` to the quote's deposit address, a custodial EOA that Tidepool's relayer sweeps.
 */
import {
  GetExecutionStatusResponse,
  OneClickService,
  OpenAPI,
  QuoteRequest,
} from "@defuse-protocol/one-click-sdk-typescript";
import type { Address, Hex } from "viem";
import { config } from "@quitclaim/shared";
import { logger } from "@quitclaim/sdk/logger.ts";

OpenAPI.BASE = config.intents.apiBase;

export const Status = GetExecutionStatusResponse.status;

/** One live exact-input quote: `amount` of the lot token on Base for Tidepool wNEAR paid to `recipient`. */
export async function quote(
  amount: bigint,
  refundTo: Address,
  recipient: string,
) {
  const res = await OneClickService.getQuote({
    dry: false,
    swapType: QuoteRequest.swapType.EXACT_INPUT,
    slippageTolerance: 100,
    originAsset: config.intents.originAsset,
    depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
    destinationAsset: `nep141:${config.intents.wnear}`,
    amount: amount.toString(),
    refundTo,
    refundType: QuoteRequest.refundType.ORIGIN_CHAIN,
    recipient,
    recipientType: QuoteRequest.recipientType.DESTINATION_CHAIN,
    deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  const { depositAddress, deadline } = res.quote;
  if (!depositAddress || !deadline)
    throw new Error(
      `live quote ${res.correlationId} has no deposit address or deadline`,
    );
  return {
    ...res,
    quote: {
      ...res.quote,
      depositAddress: depositAddress as Address,
      deadline,
    },
  };
}

export const submitDeposit = (txHash: Hex, depositAddress: Address) =>
  OneClickService.submitDepositTx({ txHash, depositAddress });

export const terminal = new Set([
  Status.SUCCESS,
  Status.REFUNDED,
  Status.FAILED,
]);

/** One status request, cancelled after `ms`. Null when it times out or errors; the caller polls again. */
export async function statusWithin(depositAddress: Address, ms: number) {
  const req = OneClickService.getExecutionStatus(depositAddress);
  const timer = setTimeout(() => req.cancel(), Math.max(ms, 1));
  try {
    return await req;
  } catch (err) {
    logger.warn({ err, depositAddress }, "Swap status request failed");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Polls the swap until SUCCESS, REFUNDED or FAILED, or until `timeoutMs` passes, bounding each
 * request by the time left. Returns the last status seen, or null if none arrived.
 */
export async function awaitSwap(depositAddress: Address, timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  let last: GetExecutionStatusResponse | null = null;
  while (Date.now() < until) {
    const next = await statusWithin(depositAddress, until - Date.now());
    if (next && next.status !== last?.status)
      logger.info({ depositAddress, status: next.status }, "Swap status");
    last = next ?? last;
    if (last && terminal.has(last.status)) break;
    await Bun.sleep(Math.min(5_000, Math.max(until - Date.now(), 0)));
  }
  return last;
}
