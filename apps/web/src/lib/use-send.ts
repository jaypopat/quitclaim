import { useWallet } from "./wallet.tsx";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ContractCall } from "@quitclaim/shared/calls.ts";
import { nearProvider, nearTxUrl } from "@quitclaim/shared/near.ts";
import { getTransactionLastResult } from "near-api-js";
import { toast } from "sonner";
import { z } from "zod";
import { LOT_CONTRACT } from "./contract.ts";

declare global {
  interface Window {
    quitclaimTestSign?: (
      call: ContractCall & { contractId: string },
    ) => Promise<unknown>;
  }
}
const submitted = z.object({ transaction: z.object({ hash: z.string() }) });

/** Build one call, approve it in the wallet, then wait for its MPC callbacks before re-reading. */
export function useSend() {
  const { callFunctionRaw, signedAccountId } = useWallet();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (build: () => ContractCall | Promise<ContractCall>) => {
      if (!signedAccountId) throw new Error("Connect a wallet first.");
      const call = await build();
      const raw =
        import.meta.env.MODE === "browser-test" && window.quitclaimTestSign
          ? await window.quitclaimTestSign({
              ...call,
              contractId: LOT_CONTRACT,
            })
          : await callFunctionRaw({
              contractId: LOT_CONTRACT,
              method: call.method,
              args: { ...call.args },
              gas: String(call.gas),
              deposit: String(call.deposit),
            });
      // Wallets may return before execution finishes. A pending callback is not a failed mint.
      const { transaction } = submitted.parse(raw);
      const result = await nearProvider.viewTransactionStatus({
        txHash: transaction.hash,
        accountId: signedAccountId,
        waitUntil: "FINAL",
      });
      const url = nearTxUrl(transaction.hash);
      if (typeof result.status === "object" && "Failure" in result.status)
        throw new Error(
          `${call.method} failed: ${JSON.stringify(result.status.Failure)} ${url}`,
        );
      return {
        method: call.method,
        url,
        value: getTransactionLastResult(result),
      };
    },
    onSuccess: ({ method, url }) => {
      toast.success(`${method} sent`, {
        action: { label: "View", onClick: () => window.open(url) },
      });
      return queryClient.invalidateQueries();
    },
    onError: (error) => toast.error(error.message),
  });
}
