import { parseEvidence } from "@quitclaim/shared/heist/evidence.ts";
import { decodeFunctionData, erc20Abi, parseTransaction } from "viem";
import published from "../../../../reports/heist.json";

/** The published handover run (`reports/heist.json`), checked against its schema at load. */
export const evidence = parseEvidence(published);

const retained = parseTransaction(evidence.retained);
if (!retained.data || retained.nonce === undefined)
  throw new Error("The published retained transaction is incomplete");
const transfer = decodeFunctionData({ abi: erc20Abi, data: retained.data });
if (transfer.functionName !== "transfer")
  throw new Error(
    "The published retained transaction must be a token transfer",
  );

/** What the seller signed and kept: its nonce on the lot address and the USDC it would move. */
export const retainedWithdrawal = {
  nonce: retained.nonce,
  amount: transfer.args[1],
};
