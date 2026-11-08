import { useWallet } from "@/lib/wallet.tsx";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ContractCall } from "@quitclaim/shared/calls.ts";
import { nearTxUrl } from "@quitclaim/shared/near.ts";
import {
  getTransactionLastResult,
  type FinalExecutionOutcome,
} from "near-api-js";
import { toast } from "sonner";
import { z } from "zod";
import { LOT_CONTRACT } from "./contract.ts";

/** Nothing when the wallet redirected to approve (the result arrives on return), else the final outcome. */
const outcome = z
  .object({
    transaction: z.object({ hash: z.string() }),
    status: z.union([
      z.string(),
      z.object({ Failure: z.unknown().optional() }),
    ]),
  })
  .optional();

/** Builds a call (some need live Base fees first), sends it through the wallet, then re-reads every chain query. */
export function useSend() {
  const { callFunction } = useWallet();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (build: () => ContractCall | Promise<ContractCall>) => {
      const call = await build();
      const raw = await callFunction({
        ...call,
        contractId: LOT_CONTRACT,
        args: { ...call.args },
      });
      const sent = outcome.parse(raw);
      const url = sent && nearTxUrl(sent.transaction.hash);
      if (sent && typeof sent.status === "object" && sent.status.Failure)
        throw new Error(
          `${call.method} failed: ${JSON.stringify(sent.status.Failure)} ${url}`,
        );
      // What the call (or the promise it returned) resolved to, such as `mint_proven`'s minted lot.
      const value =
        sent && getTransactionLastResult(raw as FinalExecutionOutcome);
      return { method: call.method, url, value };
    },
    onSuccess: ({ method, url }) => {
      toast.success(
        `${method} sent`,
        url
          ? { action: { label: "View", onClick: () => window.open(url) } }
          : undefined,
      );
      return queryClient.invalidateQueries();
    },
    onError: (error) => toast.error(error.message),
  });
}
