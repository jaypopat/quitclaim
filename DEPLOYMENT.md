# Hackathon deployment

Dokploy runs the root `compose.yml` (web app and keeper) on one host. Cloudflare's proxy terminates HTTPS in front of it.

The browser reads the chains, signs NEAR calls through the wallet, and tracks cash-out. The web server sponsors example streams and source pulls from the funder key. Each example-stream request funds a new 5 test USDC stream. The keeper settles lots with `bun apps/keeper/src/keeper.ts --watch`.

## What gets stored

- NEAR stores ownership, listings, leases, and outstanding signatures.
- Browser localStorage keeps mint progress and cash-out records through reloads. Zustand manages those records.

## Running it

For local development, run `bun run dev` and `bun run keeper --watch` from the repository root in separate terminals.

On Dokploy:

1. Create a Compose app from this repo with Compose Path `./compose.yml`. Leave isolated deployments off and use Docker Compose mode, not Stack, because Stack can't build.
2. Paste the root `.env` into the Environment tab. Dokploy writes it to `.env` beside `compose.yml`, which both services read.
3. Under Advanced → Mounts, add a file mount named `keeper.json` holding `~/.near-credentials/testnet/$KEEPER_ACCOUNT.json`. Compose mounts it from `../files/keeper.json`.
4. Add a domain on the `web` service, port 3000, with HTTPS off.
5. In Cloudflare DNS, add a proxied (orange cloud) A record for that subdomain pointing at the host's IP. Set SSL/TLS mode to Flexible.
6. Open port 80 in the cloud firewall. On Oracle Cloud that is the VCN security list.

`LOT_CONTRACT` is baked into the browser bundle at build time, so redeploy after changing it.
