export const config = {
  near: {
    networkId: "testnet",
    rpcUrl: "https://rpc.testnet.fastnear.com",
    mpcSigner: "v1.signer-prod.testnet",
    signDomain: 0,
    foreignTxDomain: 3,
  },
  evm: {
    chainId: 84532,
    foreignChain: "Base",
    rpcUrl: process.env.BASE_RPC ?? "https://base-sepolia-rpc.publicnode.com",
    explorer: "https://sepolia.basescan.org",
  },
} as const;
