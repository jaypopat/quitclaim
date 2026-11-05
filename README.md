# Quitclaim

Sell control of a payout address. The address and vesting schedule stay the same; its controller changes.

**Try the retained-signature heist:** after `bun install`, run `bun run heist`. No wallet, keys, `.env`, or funds are needed. See the [judge guide](JUDGE.md) for the live checks, public evidence, and current development finality.

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

`bun run verify` type checks, runs the TS and Rust unit tests, builds the lot contract, runs local NEAR Sandbox tests, and builds and tests the EVM contracts. Needs Bun, Rust 1.96 with `wasm32-unknown-unknown`, `cargo-near` and Foundry. The first Sandbox run downloads the node binary; it needs loopback networking and no testnet funds.

`bun run test:sandbox` runs the deployed-WASM receipt tests alone. A local MPC fixture injects verification and signing failures. The suite checks mint rollback and storage refunds, private callback enforcement, sales, and payout restoration after a real failed transfer receipt. Real MPC attestations and Base execution remain covered by `bun run e2e`.

For a release, commit the source and run `bun run build:release`. This uses Docker and the digest-pinned SourceScan image with Rust 1.96 and cargo-near 0.21.1. Keep the resulting artifact for deployment and compare its hash with the deployed code. Development builds from `build:lot` are not evidence of source reproducibility.

## Commands

- `bun run dev` serves the frontend with HMR.
- `bun run heist [evidence.json]` verifies the published handover and replays the consumed retained transaction using public RPCs. It defaults to `reports/heist.json`.
- `bun run test:heist` runs that live command with an empty home, working directory and credential environment. It is separate from deterministic `verify`.
- `bun run lot-address <lot-contract> <path>` prints a lot's Base address.
- `bun run deploy-lot <account> [Latest|Safe]` creates the account (a sub-account of `DEPLOYER_ACCOUNT` or a top-level `<name>.testnet`) and deploys the lot contract.
- `bun run e2e [minting|handover|recovery]` runs the end-to-end adversarial suite on fresh lots against testnet and writes a report with every tx link to `reports/`. `minting` covers a front-run mint refused, a cancelable stream refused, and an MPC-proven mint. `handover` covers a retained withdrawal and the heist, a transfer with an outstanding request, an outsider pulling the stream during a listing, a sale with a minter royalty and pulled payouts, and a resale to a third owner at the same address. `recovery` covers a pending-withdrawal replacement, a stalled burn repriced after a rescue, and the keeper rescuing a reverted transfer.
- `bun run keeper [--watch]` discovers lots in pages of 100 and settles unproven transactions: it tops up gas, broadcasts (only burns while Sealing), proves, and rescues a reverted nonce. Each action is permissionless, so anyone can run one.
- `bun run freeze` deletes every full-access key on `LOT_CONTRACT`, once, at the very end. It refuses unless the newest report of every e2e scenario passed at Safe finality against the deployed code hash, and it asks for typed confirmation. It is irreversible.

Ops scripts need a root `.env`; see `.env.example`.

The handover scenario uses `MINTER_ACCOUNT` for the lot's minter and royalty beneficiary, defaulting to `DEPLOYER_ACCOUNT`.

Public lot views now return `minter` in place of `issuer`. Use a deployment built from this revision with the updated ops scripts.

Changing the lot contract account or the path scheme changes every lot address.

## Proof and recovery

`prove` uses only hashes recorded for the lot and does not lock out concurrent proofs. A failed proof cannot hold up an honest one. Stale proof callbacks do not advance the nonce again.

The hardened contract removes the stored proof lock and changes `rebump`'s arguments. Deploy it to a fresh development account; existing deployments require a state migration before an upgrade.

Fees have a 1 Mwei floor. Each replacement raises both fees by at least 10%, under hard caps, with at most 16 issued transactions per nonce. If the limits prevent another replacement, transfer remains blocked until consumption is proven.

If a transfer mines but reverts, MPC cannot prove it. During Sealing, `rescue` signs a burn at the next nonce; proving that burn proves the reverted nonce consumed too. `rebump` takes an explicit nonce so the earlier burn remains repriceable after rescue.

Reports record finality, the deployed code hash, and the decoded retained transaction. `Latest` runs are development checks. The final demo requires `Safe`; Base reorganizations beyond that finality remain a risk. Proofs rely on honest MPC attestation and its RPC-provider quorum.

## The asset: a Sablier stream

A funder creates a Sablier Lockup v4 linear stream (`0xA65A1ecEf02C2B9BDc604951c6A6D02335D4532e` on Base Sepolia) with the lot address as recipient, `cancelable = false` and `transferable = false`. Sablier enforces the rest:

- Anyone may withdraw vested tokens, but only **to the recipient**. Withdrawing to any other address reverts with `SablierLockup_WithdrawalAddressNotRecipient`.
- Nobody can cancel the stream (`SablierLockup_StreamNotCancelable`) or move its NFT (`SablierLockup_NotTransferable`).

Quitclaim moves control of the recipient address, not the stream. The lot contract never signs Sablier calls. Anyone pulls the stream into the lot. The owner moves tokens out with a contract-built ERC-20 `transfer` of the token fixed at mint. So, while a lot is listed, outsiders can move value from the stream into the lot, but nothing can reduce the lot's total (still streaming plus held).

## Minting, with no admin

The intended user is a holder who wants to sell a future payout and a buyer who needs a verifiable handover. Before funding, the minter derives a lot address under `<minter account>/<name>` and arranges for the stream to pay it. Existing streams paying ordinary wallets cannot be imported.

The minter calls `mint_proven(name, owner, royalty_bps, log)` with the stream's `CreateLockupLinearStream` log. The contract checks the configured Sablier emitter, linear-stream event, non-cancelable and non-transferable flags, and recipient equal to the derived lot address. MPC attests that exact log at the contract's finality, with an expected payload hash computed using its pinned interface crate. If attestation fails, the mint rolls back. The token and stream come from the attested log.

Minting is permissionless by design. The **minter** is the NEAR caller who chooses the initial owner and receives the minter royalty. The **owner** controls the lot. The source stream's sender and funder are separate roles. Minting does not require or record their approval of a sale. A cooperating source sender can also mint a lot for another owner.

A holder can sell their economic exposure before vesting finishes. The tokens continue to unlock on the original schedule. Source verification and Clean do not establish the sender's approval or transfer off-chain rights.

Namespacing stops front-running: anyone watching Base could see a new stream, but minting it under their own account derives a different address, so the recipient check fails.

A buyer can still re-run the title search from Base: recipient is the lot, non-cancelable, non-transferable, token matches.

Quitclaim is not affiliated with or endorsed by Sablier.

**Why not create the stream transferable?** If the source sender offers a transferable Sablier stream, trading its NFT is a simpler option. A [Safe with owner rotation](https://docs.safe.global/reference-smart-account/owners/swapOwner) or an [ERC-6551 account that checks the current NFT owner](https://eips.ethereum.org/EIPS/eip-6551#example-account-implementation) is also a genuine alternative. Quitclaim packages a fixed set of signing capabilities, a NEAR NFT title, and a purchase that moves the title and credits payment in one call. It proves nonce consumption for a native Base address; it does not claim smart accounts inherently accept an old owner's signatures. The testnet demonstrates the mechanism, not customer demand.

## The NFT

Each lot is a NEP-171 token whose `media` is an SVG title card rendered on chain (lot id, Base address, Sablier stream, state), so wallets show it without hosted images.

## Sale and royalty

An owner lists a lot only while it is Clean, so nothing can sign and the position can't change under the offer. The listing is bound to the lot's version, and `unseal` or any transfer cancels it.

`buy(id, version)` is one call. It checks the lot is Clean, the listing matches the version the buyer saw, and the deposit equals the price. It then moves the title and credits the seller and the minter in contract state, with no cross-contract calls, so title and credit can't diverge.

The minter royalty is fixed at mint and capped at 10%. Integer rounding favours the seller. `nft_payout` (NEP-199) is a view of exactly what `buy` credits. There is no `nft_transfer_payout`, and a direct `nft_transfer` pays no royalty: "minter royalties on Quitclaim sales" only.

Proceeds are pulled with `withdraw_proceeds`. The balance is zeroed before the transfer and restored once if the transfer fails.

## License

[MIT](LICENSE).
