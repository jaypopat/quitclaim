import type { WalletSelectorParams } from "@near-wallet-selector/core";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";

/**
 * No function-call key is added at sign-in, so every lot call goes through full wallet approval
 * with the exact deposit it carries. Meteor and HERE are left out: their selector modules (10.1.4)
 * sit on near-js v1 or near-api-js 6, which need Node globals or a `utils` export near-api-js 7 dropped.
 */
export const walletConfig: WalletSelectorParams = {
  network: "testnet",
  modules: [setupMyNearWallet()],
};
