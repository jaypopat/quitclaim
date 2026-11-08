import { NearConnector } from "@hot-labs/near-connect";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { z } from "zod";
import { config } from "@quitclaim/shared/config.ts";
import { nearProvider } from "@quitclaim/shared/near.ts";
import type { ContractCall } from "@quitclaim/shared/calls.ts";

type WalletCall = ContractCall & { contractId: string };
type WalletContext = {
  signedAccountId: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  callFunction: (call: WalletCall) => Promise<unknown>;
};

declare global {
  interface Window {
    quitclaimTestSign?: (call: WalletCall) => Promise<unknown>;
  }
}

const Context = createContext<WalletContext | null>(null);

/** No login key: every transaction is approved by the wallet with its exact deposit. */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [connector] = useState(
    () =>
      new NearConnector({
        network: "testnet",
        providers: { testnet: [config.near.rpcUrl] },
        features: { signInWithoutAddKey: true, signAndSendTransaction: true },
      }),
  );
  const [account, setAccount] = useState<string | null>(() =>
    import.meta.env.MODE === "browser-test"
      ? sessionStorage.getItem("quitclaim-test-account")
      : null,
  );
  useEffect(() => {
    if (import.meta.env.MODE === "browser-test" && window.quitclaimTestSign)
      return;
    let active = true;
    const signedIn = ({ accounts }: { accounts: { accountId: string }[] }) => {
      if (active) setAccount(accounts[0]?.accountId ?? null);
    };
    const signedOut = () => {
      if (active) setAccount(null);
    };
    connector.on("wallet:signIn", signedIn);
    connector.on("wallet:signOut", signedOut);
    void connector.getConnectedWallet().then(signedIn).catch(signedOut);
    return () => {
      active = false;
      connector.off("wallet:signIn", signedIn);
      connector.off("wallet:signOut", signedOut);
    };
  }, [connector]);
  const value: WalletContext = {
    signedAccountId: account,
    signIn: async () => {
      try {
        await connector.connect();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    signOut: async () => {
      await connector.disconnect();
      setAccount(null);
    },
    callFunction: async (call) => {
      if (!account) throw new Error("Connect a wallet first.");
      const raw =
        import.meta.env.MODE === "browser-test" && window.quitclaimTestSign
          ? await window.quitclaimTestSign(call)
          : await (
              await connector.wallet()
            ).signAndSendTransaction({
              signerId: account,
              receiverId: call.contractId,
              actions: [
                {
                  type: "FunctionCall",
                  params: {
                    methodName: call.method,
                    args: call.args,
                    gas: String(call.gas),
                    deposit: String(call.deposit),
                  },
                },
              ],
            });
      // Wallets may return at NONE. MPC callbacks have to finish before reading their return value.
      const { transaction } = transactionOutcome.parse(raw);
      return nearProvider.viewTransactionStatus({
        txHash: transaction.hash,
        accountId: account,
        waitUntil: "FINAL",
      });
    },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

const transactionOutcome = z.object({
  transaction: z.object({ hash: z.string() }),
});

export function useWallet() {
  const wallet = useContext(Context);
  if (!wallet) throw new Error("WalletProvider is missing");
  return wallet;
}
