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
import { logger } from "./logger.ts";

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

const terminal = new Set([Status.SUCCESS, Status.REFUNDED, Status.FAILED]);

/** Polls the swap until SUCCESS, REFUNDED or FAILED, or until `timeoutMs` passes. Returns the last status. */
export async function awaitSwap(depositAddress: Address, timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  let last = await OneClickService.getExecutionStatus(depositAddress);
  logger.info({ depositAddress, status: last.status }, "Swap status");
  while (!terminal.has(last.status) && Date.now() < until) {
    await Bun.sleep(5_000);
    const next = await OneClickService.getExecutionStatus(depositAddress);
    if (next.status !== last.status)
      logger.info({ depositAddress, status: next.status }, "Swap status");
    last = next;
  }
  return last;
}
