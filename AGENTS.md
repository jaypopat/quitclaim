# Quitclaim

NEAR hackathon entry (`nfts` track, deadline 2026-11-14 23:59 UTC). A NEP-171 NFT is the title to an address on Base Sepolia. NEAR Chain Signatures signs for that address only on behalf of the NFT's owner. Before the title moves, the contract burns the old owner's outstanding nonce, and MPC `verify_foreign_transaction` proves the burn landed. `SPEC.md` is the design; `HACKATHON.md` is the brief.

## Layout

- `contracts/lot` is the NEAR contract (Rust, `cargo near`, in the root Cargo workspace).
- `contracts/evm` holds the test ERC-20 that lots hold and streams are funded in (Foundry, forge-std submodule). Lots' value comes from real Sablier Lockup v4 streams on Base Sepolia (`packages/ops/src/sablier.ts`).
- `packages/shared` holds chain config and lot-address derivation.
- `packages/ops` holds Bun scripts.
- `apps/web` is the frontend.
- `spikes/` is gitignored throwaway work. `spikes/notes/` holds the verified on-chain facts and tx links.

## Commands

- `bun run verify` runs everything: typecheck, TS tests, lot test and build, EVM build and test. Run it before committing.
- `bun run test:sandbox` builds the lot and local MPC fixture and runs deployed-WASM receipt tests with `near-sandbox` and `near-api`. It is included in `verify`; no testnet funds are needed.
- `bun run build:release` builds committed source reproducibly with the digest-pinned Docker image. Use its artifact for the final deployment.
- `bun run dev` serves the web app.
- `bun run lot-address <lot-contract> <path>` prints a lot's Base address.
- `bun run deploy-lot <account> [Latest|Safe]` creates the account (a sub-account of `DEPLOYER_ACCOUNT` or a top-level `<name>.testnet`) and deploys the lot contract.
- `bun run e2e [minting|handover|recovery|lease]` runs the end-to-end adversarial suite on fresh lots against testnet and writes `reports/e2e-<scenario>-*.md`. Scenarios live in `packages/ops/src/e2e/`.
- `bun run heist [evidence.json]` verifies a published handover and replays its consumed retained transaction using public RPCs. It defaults to `reports/heist.json` and needs no keys, `.env`, or funds.
- `bun run test:heist` runs the live heist command with an empty home and working directory, dotenv disabled, and no credential environment. It is separate from deterministic `verify`.
- `bun run keeper [--watch]` settles lots: seal or end a run-out lease, gas top-up, broadcast, prove, rescue. Every action is permissionless.
- `bun run freeze` deletes every full-access key on `LOT_CONTRACT`, once, at the very end. It refuses unless the newest report of every e2e scenario passed at Safe finality against the deployed code hash, and it asks for typed confirmation. It is irreversible.
- Wallet-backed ops scripts read the root `.env` (copy `.env.example`), so run them from the repo root. The keyless heist uses public RPCs without it. `DEPLOYER_ACCOUNT` is only the parent account for `deploy-lot`; it has no power over deployed contracts.

## Conventions

- Bun only: `bun test`, `bun check`, `bunx`, `Bun.serve` with HTML imports (no Vite, Express or dotenv; Bun loads `.env`).
- Don't name a root script `check`, because it shadows `bun check`.
- No AI co-author trailers or attribution in commits or PRs.

## Invariants (the security model; don't weaken)

- Record a tx as issued **before** calling `sign`. MPC signatures are public in the signer's receipts.
- At most one outstanding nonce per lot. Any new tx at that nonce raises **both** EIP-1559 fees by ≥10%, under hard caps.
- A burn with no recorded signature is re-signed in place; only burns are ever re-signed.
- `prove` only uses tx hashes from contract state. Any signature accepted from outside must `ecrecover` to the lot address, or an attacker can sign the same payload with their own key and fake Clean.
- Transfer and sale only from `Clean`, and every title or lease move goes through `move_title`. Listings and lease offers are bound to the lot version.
- One controller: `controller(lot)` is the lease holder while a lease exists, else the title owner. Signing, sealing, unsealing and listing check it, never the owner directly.
- Moving the controlling token requires `Clean`. A lease token moves only like a title: version + 1, Active for the new holder, listing cleared.
- The title can't move, be listed or be sold while a lease exists. A lease ends only at `Clean` (expiry or surrender), so every signature its holders got is burned and proven first. After expiry anyone may seal, and nobody may unseal.
- A lessee moves out at most what the attested schedule vested during the lease (`Schedule::vested`, Sablier's `calculateStreamedAmountLL` exactly). Each nonce is charged its largest issued transfer; burns are free; the charge carries over on resale. Contract-built txs only: ERC-20 `transfer(to, amount)` on the token fixed at mint, and the burn. Never raw-hash signing.
- The lot never signs calls to Sablier (or any source). Anyone pulls the stream into the lot; a lot-signed withdrawal could be griefed into reverting (`WithdrawAmountZero`). Outsiders can only add to the lot's balance.
- `buy` credits proceeds in state with no cross-contract calls. Payouts are pulled; `withdraw_proceeds` zeroes before transferring and restores once on failure.
- Use the MPC `recovery_id` as yParity as-is. Strip leading zeros from r/s before RLP.
- Minting has no admin. `mint_proven` takes Sablier's `CreateLockupLinearStream` log, checks emitter, event, non-cancelable, non-transferable and that the recipient is the derived lot address, then has MPC attest that exact log (`expected_payload_hash`, computed with `near-mpc-contract-interface` pinned to the signer's revision). Any failure rolls the mint back.
- Paths are `<minter account>/<name>`, set by the contract. A front-runner minting someone else's stream gets a different address, so the recipient check fails. The minter is the NEAR caller and royalty beneficiary; minting requires no source-sender authorization.
- The lot address depends on the lot contract account plus the path. Changing either orphans every lot.

## Gotchas

- `sign` and `verify_foreign_transaction` each need 1 yoctoNEAR and at least 15 Tgas. Ethereum isn't whitelisted for verification; Base is. Every failed verification is a silent ~115 s timeout.
- Base charges an L1 fee on top of L2 gas. Estimate gas per tx; never hardcode it.
- RPCs live in `packages/shared/src/config.ts`. Base has one. NEAR has two: `rpcUrl` for all live traffic, and `archivalRpcUrl` only where history is needed (the heist's transaction and receipt lookups). FastNEAR's archival tier rate-limits live e2e traffic with HTTP 429, and the regular node prunes old receipts. Local DNS blocks some hosts; these resolve here.
- The funder key is in the root `.env` (gitignored, 0600). Never print or commit it.
- A call that returns a `Promise` must be added to `resolvesVia` in `packages/shared/scripts/gen-abi.ts`, or `bun run abi` fails.
- `Safe` finality on Base Sepolia takes ~5–7 min per proof. Use a `Latest` contract for fast iteration.
