# Quitclaim

A NEP-171 NFT is the title to an address on Base Sepolia. The contract requests Chain Signatures only for the NFT's owner. Before the title moves, MPC foreign-transaction verification proves the old owner's outstanding nonce was consumed. Either an issued claim or a burn can consume it.

This is a testnet prototype with a mock vesting asset. Signature enforcement depends on the MPC network and the contract's upgrade policy. Development deployments retain full-access keys: their holder can upgrade the contract or request signatures directly. The final demo deployment must disclose its key policy.

## Layout

- `contracts/lot` is the NEAR contract (Rust, `cargo near`).
- `contracts/vesting` is the mock non-transferable vesting contract (Foundry).
- `packages/shared` holds chain config and lot-address derivation, used by every TS package.
- `packages/ops` holds Bun scripts for provisioning, broadcasting and proving.
- `apps/web` is the frontend (`Bun.serve` with HTML imports and React).

## Setup

```bash
git submodule update --init
bun install
bun run verify
```

`bun run verify` type checks, runs the TS tests, tests and builds the lot contract, and builds and tests the vesting contract. Needs Bun, Rust 1.96 with `wasm32-unknown-unknown`, `cargo-near` and Foundry.

## Commands

- `bun run dev` serves the frontend with HMR.
- `bun run lot-address <lot-contract> <path>` prints a lot's Base address.
- `bun run deploy-lot <prefix> [Latest|Safe]` deploys a lot contract to `<prefix>.<ADMIN_ACCOUNT>`.
- `bun run gate1` runs the adversarial handover on two fresh lots and writes a report with every tx link to `reports/`. It covers a transfer during signing, a retained claim, a pending-claim replacement, and rescue after a reverted claim.

Ops scripts need a root `.env`; see `.env.example`.

Changing the lot contract account or the path scheme changes every lot address.

## Proof and recovery

`prove` uses only hashes recorded for the lot and does not lock out concurrent proofs. A failed proof cannot hold up an honest one. Stale proof callbacks do not advance the nonce again.

The hardened contract removes the stored proof lock and changes `rebump`'s arguments. Deploy it to a fresh development account; existing deployments require a state migration before an upgrade.

Fees have a 1 Mwei floor. Each replacement raises both fees by at least 10%, under hard caps, with at most 16 issued transactions per nonce. If the limits prevent another replacement, transfer remains blocked until consumption is proven.

If a claim mines but reverts, MPC cannot prove it. During Sealing, `rescue` signs a burn at the next nonce; proving that burn proves the reverted nonce consumed too. `rebump` takes an explicit nonce so the earlier burn remains repriceable after rescue.

Reports record finality, the deployed code hash, and the decoded retained transaction. `Latest` runs are development checks. The final demo requires `Safe`; Base reorganizations beyond that finality remain a risk. Proofs rely on honest MPC attestation and its RPC-provider quorum.

Sale, royalty, and pull payouts are the next implementation step. The planned royalty applies to Quitclaim sales; direct `nft_transfer` pays no royalty.

## License

[MIT](LICENSE).
