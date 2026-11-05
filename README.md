# Quitclaim

A NEP-171 NFT is the title to an address on Base Sepolia. NEAR Chain Signatures only signs for that address on behalf of the NFT's owner. Before the title moves, the contract burns the old owner's outstanding nonce, and MPC foreign-transaction verification proves the burn landed.

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
- `bun run --cwd packages/ops lot-address <lot-contract> <path>` prints a lot's Base address.

Changing the lot contract account or the path scheme changes every lot address.
