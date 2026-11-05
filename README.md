# Quitclaim

A NEP-171 NFT is the title to an address on Base Sepolia. The contract requests Chain Signatures only for the NFT's owner. Before the title moves, MPC foreign-transaction verification proves the old owner's outstanding nonce was consumed. Either an issued transfer or a burn can consume it.

This is a testnet prototype. Each lot's value is a real Sablier Lockup v4 stream on Base Sepolia, created non-cancelable and non-transferable with the lot address as recipient, funded in a test ERC-20. Signature enforcement depends on the MPC network and the contract's upgrade policy. Development deployments retain full-access keys: their holder can upgrade the contract or request signatures directly. The final demo deployment must disclose its key policy.

## Layout

- `contracts/lot` is the NEAR contract (Rust, `cargo near`).
- `contracts/evm` holds the test ERC-20 the lots hold (Foundry).
- `packages/shared` holds chain config and lot-address derivation, used by every TS package.
- `packages/ops` holds Bun scripts for provisioning, broadcasting and proving.
- `apps/web` is the frontend (`Bun.serve` with HTML imports and React).

## Setup

```bash
git submodule update --init
bun install
bun run verify
```

`bun run verify` type checks, runs the TS tests, tests and builds the lot contract, and builds and tests the EVM contracts. Needs Bun, Rust 1.96 with `wasm32-unknown-unknown`, `cargo-near` and Foundry.

## Commands

- `bun run dev` serves the frontend with HMR.
- `bun run lot-address <lot-contract> <path>` prints a lot's Base address.
- `bun run deploy-lot <prefix> [Latest|Safe]` deploys a lot contract to `<prefix>.<DEPLOYER_ACCOUNT>`.
- `bun run e2e [minting|handover|recovery]` runs the end-to-end adversarial suite on fresh lots against testnet and writes a report with every tx link to `reports/`. `minting` covers a front-run mint refused, a cancelable stream refused, and an MPC-proven mint. `handover` covers a retained withdrawal and the heist, a transfer with an outstanding request, an outsider pulling the stream during a listing, a sale with an issuer royalty and pulled payouts. `recovery` covers a pending-withdrawal replacement, a stalled burn repriced after a rescue, and the keeper rescuing a reverted transfer.
- `bun run keeper [--watch]` settles every lot with unproven transactions: it tops up gas, broadcasts (only burns while Sealing), proves, and rescues a reverted nonce. Each action is permissionless, so anyone can run one.

Ops scripts need a root `.env`; see `.env.example`.

Changing the lot contract account or the path scheme changes every lot address.

## Proof and recovery

`prove` uses only hashes recorded for the lot and does not lock out concurrent proofs. A failed proof cannot hold up an honest one. Stale proof callbacks do not advance the nonce again.

The hardened contract removes the stored proof lock and changes `rebump`'s arguments. Deploy it to a fresh development account; existing deployments require a state migration before an upgrade.

Fees have a 1 Mwei floor. Each replacement raises both fees by at least 10%, under hard caps, with at most 16 issued transactions per nonce. If the limits prevent another replacement, transfer remains blocked until consumption is proven.

If a transfer mines but reverts, MPC cannot prove it. During Sealing, `rescue` signs a burn at the next nonce; proving that burn proves the reverted nonce consumed too. `rebump` takes an explicit nonce so the earlier burn remains repriceable after rescue.

Reports record finality, the deployed code hash, and the decoded retained transaction. `Latest` runs are development checks. The final demo requires `Safe`; Base reorganizations beyond that finality remain a risk. Proofs rely on honest MPC attestation and its RPC-provider quorum.

## The asset: a Sablier stream

The issuer creates a Sablier Lockup v4 linear stream (`0xA65A1ecEf02C2B9BDc604951c6A6D02335D4532e` on Base Sepolia) with the lot address as recipient, `cancelable = false` and `transferable = false`. Sablier enforces the rest:

- Anyone may withdraw vested tokens, but only **to the recipient**. Withdrawing to any other address reverts with `SablierLockup_WithdrawalAddressNotRecipient`.
- Nobody can cancel the stream (`SablierLockup_StreamNotCancelable`) or move its NFT (`SablierLockup_NotTransferable`).

Quitclaim moves control of the recipient address, not the stream. The lot contract never signs Sablier calls. Anyone pulls the stream into the lot. The owner moves tokens out with a contract-built ERC-20 `transfer` of the token fixed at mint. So, while a lot is listed, outsiders can move value from the stream into the lot, but nothing can reduce the lot's total (still streaming plus held).

## Minting, with no admin

An issuer creates the stream to a lot address in their own namespace: the contract sets every lot's path to `<issuer account>/<name>`. The issuer then calls `mint_proven(name, owner, royalty_bps, log)` with the stream's `CreateLockupLinearStream` log. The contract checks the emitter is the configured Sablier Lockup, the event is a linear-stream creation, the stream is non-cancelable and non-transferable, and its recipient is the address it derives for that path. It then asks MPC to attest that exact log at the contract's finality, passing the payload hash it computed (with MPC's own interface crate, pinned to the signer's revision). MPC answers only if Base has that log in a successful, canonical transaction; otherwise the mint rolls back. The lot's token and stream come from the attested log, not from the caller.

Namespacing stops front-running: anyone watching Base could see a new stream, but minting it under their own account derives a different address, so the recipient check fails.

A buyer can still re-run the title search from Base: recipient is the lot, non-cancelable, non-transferable, token matches.

Quitclaim is not affiliated with or endorsed by Sablier.

**Why not create the stream transferable?** A transferable Sablier stream is a freely tradable ERC-721: anyone can sell it anywhere, with no issuer gating and no royalty enforcement. Quitclaim is for issuers who want transfers gated through one handover rule (seal, prove the old signatures dead, then move), with royalties on Quitclaim sales and a visible history. The allocation still has to name the lot address from the start.

## Sale and royalty

An owner lists a lot only while it is Clean, so nothing can sign and the position can't change under the offer. The listing is bound to the lot's version, and `unseal` or any transfer cancels it.

`buy(id, version)` is one call. It checks the lot is Clean, the listing matches the version the buyer saw, and the deposit equals the price. It then moves the title and credits the seller and the issuer in contract state, with no cross-contract calls, so title and credit can't diverge.

The issuer royalty is fixed at mint and capped at 10%. Integer rounding favours the seller. `nft_payout` (NEP-199) is a view of exactly what `buy` credits. There is no `nft_transfer_payout`, and a direct `nft_transfer` pays no royalty: "issuer royalties on Quitclaim sales" only.

Proceeds are pulled with `withdraw_proceeds`. The balance is zeroed before the transfer and restored once if the transfer fails.

## License

[MIT](LICENSE).
