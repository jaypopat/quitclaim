import { useWallet } from "./wallet.tsx";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ContractCall, Tx } from "@quitclaim/shared/calls.ts";
import { nearProvider, nearTxUrl } from "@quitclaim/shared/near.ts";
import { Actions } from "near-connect-hooks";
import { getTransactionLastResult } from "near-api-js";
import { toast } from "sonner";
import { z } from "zod";
import { LOT_CONTRACT } from "./contract.ts";

declare global {
  interface Window {
    quitclaimTestSign?: (tx: {
      contractId: string;
      calls: Tx;
    }) => Promise<unknown>;
  }
}
const submitted = z.object({ transaction: z.object({ hash: z.string() }) });

/** Build one transaction, approve it in the wallet, then wait for its MPC callbacks before re-reading. */
export function useSend() {
  const { signAndSendTransaction, signedAccountId } = useWallet();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      build: () => ContractCall | Tx | Promise<ContractCall | Tx>,
    ) => {
      if (!signedAccountId) throw new Error("Connect a wallet first.");
      const built = await build();
      const calls = Array.isArray(built) ? built : [built];
      const method = calls.map((c) => c.method).join(" + ");
      const raw =
        import.meta.env.MODE === "browser-test" && window.quitclaimTestSign
          ? await window.quitclaimTestSign({ contractId: LOT_CONTRACT, calls })
          : await signAndSendTransaction({
              receiverId: LOT_CONTRACT,
              actions: calls.map((c) =>
                Actions.functionCall(
                  c.method,
                  { ...c.args },
                  String(c.gas),
                  String(c.deposit),
                ),
              ),
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
          `${method} failed: ${JSON.stringify(result.status.Failure)} ${url}`,
        );
      return {
        method,
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
