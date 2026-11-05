# Quitclaim

NEAR hackathon entry (`nfts` track, deadline 2026-11-14 23:59 UTC). A NEP-171 NFT is the title to an address on Base Sepolia. NEAR Chain Signatures signs for that address only on behalf of the NFT's owner. Before the title moves, the contract burns the old owner's outstanding nonce, and MPC `verify_foreign_transaction` proves the burn landed. `SPEC.md` is the design; `HACKATHON.md` is the brief.

## Layout

- `contracts/lot` is the NEAR contract (Rust, `cargo near`, in the root Cargo workspace).
- `contracts/vesting` is the mock vesting contract (Foundry, forge-std submodule).
- `packages/shared` holds chain config and lot-address derivation.
- `packages/ops` holds Bun scripts.
- `apps/web` is the frontend.
- `spikes/` is gitignored throwaway work. `spikes/notes/` holds the verified on-chain facts and tx links.

## Commands

- `bun run verify` runs everything: typecheck, TS tests, lot test and build, vesting build and test. Run it before committing.
- `bun run dev` serves the web app.
- `bun run lot-address <lot-contract> <path>` prints a lot's Base address.
- `bun run deploy-lot <prefix> [Latest|Safe]` creates `<prefix>.<ADMIN_ACCOUNT>` and deploys the lot contract.
- `bun run gate1` runs the adversarial handover on a fresh lot and writes `reports/gate1-*.md`.
- Ops scripts read the root `.env` (copy `.env.example`), so run them from the repo root.

## Conventions

- Bun only: `bun test`, `bun check`, `bunx`, `Bun.serve` with HTML imports (no Vite, Express or dotenv; Bun loads `.env`).
- Don't name a root script `check`, because it shadows `bun check`.
- No AI co-author trailers or attribution in commits or PRs.

## Invariants (the security model; don't weaken)

- Record a tx as issued **before** calling `sign`. MPC signatures are public in the signer's receipts.
- At most one outstanding nonce per lot. Any new tx at that nonce raises **both** EIP-1559 fees by ≥10%, under hard caps.
- `prove` only uses tx hashes from contract state. Any signature accepted from outside must `ecrecover` to the lot address, or an attacker can sign the same payload with their own key and fake Clean.
- Transfer and sale only from `Clean`. Contract-built txs only (`claim(to)` and burn); never raw-hash signing.
- Use the MPC `recovery_id` as yParity as-is. Strip leading zeros from r/s before RLP.
- The lot address depends on the lot contract account plus the path. Changing either orphans every lot.

## Gotchas

- `sign` and `verify_foreign_transaction` each need 1 yoctoNEAR and at least 15 Tgas. Ethereum isn't whitelisted for verification; Base is. Every failed verification is a silent ~115 s timeout.
- Base charges an L1 fee on top of L2 gas. Estimate gas per tx; never hardcode it.
- Local DNS blocks some RPC hosts. Use publicnode for Base Sepolia and thirdweb for Sepolia.
- The funder key is in the root `.env` (gitignored, 0600). Never print or commit it.
- `Safe` finality on Base Sepolia takes ~5–7 min per proof. Use a `Latest` contract for fast iteration.
