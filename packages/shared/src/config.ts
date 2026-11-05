const list = (env: string | undefined, fallback: string[]) => (env ? env.split(",").map((s) => s.trim()).filter(Boolean) : fallback);

export const config = {
  near: {
    networkId: "testnet",
    /** Tried in order; a network error or 5xx moves to the next. Override with `NEAR_RPCS` (comma-separated). */
    rpcUrls: list(process.env.NEAR_RPCS, ["https://rpc.testnet.fastnear.com", "https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"]),
    mpcSigner: "v1.signer-prod.testnet",
    signDomain: 0,
    foreignTxDomain: 3,
  },
  evm: {
    chainId: 84532,
    foreignChain: "Base",
    /** Tried in order. Override with `BASE_RPCS` (comma-separated). */
    rpcUrls: list(process.env.BASE_RPCS ?? process.env.BASE_RPC, [
      "https://base-sepolia-rpc.publicnode.com",
      "https://sepolia.base.org",
      "https://84532.rpc.thirdweb.com",
    ]),
    explorer: "https://sepolia.basescan.org",
  },
} as const;
