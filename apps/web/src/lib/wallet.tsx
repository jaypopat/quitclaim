import { NearProvider, useNearWallet } from "near-connect-hooks";
import type { ComponentProps } from "react";
import { toast } from "sonner";
import { config } from "@quitclaim/shared/config.ts";

export { NearProvider as WalletProvider } from "near-connect-hooks";

// No function-call key is requested: payable calls require full wallet approval.
export const walletConfig = {
  network: "testnet",
  providers: { testnet: [config.near.rpcUrl] },
  features: { signInWithoutAddKey: true, signAndSendTransaction: true },
} satisfies NonNullable<ComponentProps<typeof NearProvider>["config"]>;

export function useWallet() {
  const wallet = useNearWallet();
  const testAccount =
    import.meta.env.MODE === "browser-test" && window.quitclaimTestSign
      ? sessionStorage.getItem("quitclaim-test-account")
      : null;
  return {
    signOut: wallet.signOut,
    signAndSendTransaction: wallet.signAndSendTransaction,
    signedAccountId: testAccount || wallet.signedAccountId || null,
    // React supplies a click event; the SDK's optional argument is access-key configuration.
    signIn: () =>
      wallet.signIn().catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : String(error));
      }),
  };
}
