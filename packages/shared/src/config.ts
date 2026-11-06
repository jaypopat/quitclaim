export const config = {
  near: {
    rpcUrl: "https://rpc.testnet.fastnear.com",
    /** Only for history the regular node has pruned, such as the heist's old transactions. */
    archivalRpcUrl: "https://archival-rpc.testnet.fastnear.com",
    explorer: "https://testnet.nearblocks.io",
    mpcSigner: "v1.signer-prod.testnet",
    signDomain: 0,
    foreignTxDomain: 3,
  },
  evm: {
    chainId: 84532,
    foreignChain: "Base",
    rpcUrl: "https://base-sepolia-rpc.publicnode.com",
    explorer: "https://sepolia.basescan.org",
    /** Tidepool's test USDC (6 decimals). Lots hold it; its `faucet()` mints 100 to the caller once an hour. */
    token: "0x38d81431B9f76d9699AF7517040D5221D9dEA252",
  },
} as const;
