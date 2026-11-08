# Verify the browser against testnet

The browser suite creates and funds a fresh Sablier stream, mints its title through a real NEAR signer, reloads the mint, lists and buys it, takes and surrenders a lease, withdraws on Base, and cashes out to NEAR through Tidepool. It spends test USDC, Base Sepolia ETH, and test NEAR.

1. Set up the root `.env` and the NEAR credentials described in `.env.example`. Alice, Bob, and Carol need funded NEAR accounts. The Base funder supplies the example stream, one additional test USDC, and gas.
2. Use a freshly deployed `Latest` lot contract. Set both `LOT_CONTRACT` and `VITE_LOT_CONTRACT` to it.
3. Install Chromium with `bunx playwright install chromium`.
4. Run `bun run keeper --watch` in another terminal.
5. Run `bun run test:browser` from the repository root.

Playwright starts the app on port 3001 in `browser-test` mode. The page calls an exposed binding to sign with the selected account. Keys stay in the Bun test process. Production builds remove this bridge.

The suite uses public RPCs and Tidepool's live sandbox. A rate limit or service outage fails the run. Inspect the trace and the lot's issued transactions before retrying a cash-out. Never create a second payment for an unresolved swap.

Browser cash-out and mint-recovery records use Zustand persist with validated localStorage, scoped by contract and lot or account. The storage adapter reads legacy records and blocks invalid or unknown-version records without overwriting them. One native storage listener synchronizes records across tabs; there is no custom window event.

Cash-out records survive reloads and contain the quote, deposit address, recipient, and starting Base block. The page finds the exact deposit in token Transfer logs and notifies Tidepool even after the keeper clears `issued`. Keep browser data until the swap resolves. This does not coordinate payments across devices. A cancelled or uncertain wallet approval stays recorded for manual recovery.

Example-stream funding records live under `.quitclaim/demo-streams` in the server's working directory. Preserve that directory across server restarts. A funded record returns its original transaction on retry. An interrupted pending record refuses another payment and needs operator recovery. This file store assumes one shared server filesystem.

NEAR Connect filters wallets by keyless login, transaction signing, and testnet support. The checked manifest exposes Meteor, Intear, Nightly, Ledger, Ethereum Wallets, and NEAR CLI. MyNearWallet currently lacks a testnet capability flag. Wallet availability follows the upstream manifest. A successful test binding run verifies the application and protocol, but does not verify signing inside each third-party wallet.

Run the no-funds persistence checks alone with `bun run test:browser recovery.pw.ts`. They exercise legacy migration, reloads, rejected data, and cross-tab updates in Chromium.
