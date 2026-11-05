# Can Alice steal the money back?

Alice owned a Base address receiving a Sablier stream. Before selling its title to Bob, she signed a withdrawal to herself and kept it. Quitclaim consumed that transaction's nonce before the sale, and NEAR MPC proved it on Base.

Now try to use her retained signature.

## Run the heist

After `bun install`, run this from the repository root:

```sh
bun run heist
```

You need no wallet, keys, `.env`, or funds. The command checks the published handover against public chain data, then broadcasts Alice's signed withdrawal once. It signs nothing and sends no NEAR transaction.

Expect to see the burn, MPC proof, Bob's purchase and Bob's withdrawal checked, followed by:

```text
Base rejected it: nonce too low: next nonce 3, tx nonce 1
PASS Alice's retained withdrawal was rejected. Current owner: carol.quitclaim-spike-43135.testnet.
```

The RPC wording and current nonce can change. The command exits zero only after the checks pass and Base specifically rejects the spent nonce. Other errors print `FAIL heist` and exit nonzero.

## What the checks establish

- Alice's signature is for a token withdrawal from this lot to herself on Base Sepolia.
- A successful canonical burn consumed the same nonce. That block has now reached Base Safe.
- NEAR MPC verified that burn, and the contract accepted the nonce proof.
- Bob bought Alice's title, then withdrew tokens from the same address to himself.

The lot has since been resold to Carol. The old signature remains unusable. [Published evidence](reports/heist.json) includes the raw signed bytes; [the original handover report](reports/e2e-handover-2026-11-05T13-09-25.264Z.md) records the full run.

## Inspect the transactions

- [Burn on Base](https://sepolia.basescan.org/tx/0x1155eba522eb8bfc47fc7f4ad69782566131078ca87b2421f7de30455f933499).
- [MPC proof on NEAR](https://testnet.nearblocks.io/txns/HyjkRYt84RQcbDdjiqTHun83mkz8op4RgUrHWaG7KPJw).
- [Bob's purchase](https://testnet.nearblocks.io/txns/AS4Do5zxZATgCeBpFxEpAXRDch4QgdqwkW2c4Hequ3XA).
- [Bob's withdrawal](https://sepolia.basescan.org/tx/0xc59f41515b1af3d8674f1cd20ff512d2bd2057052eb5070f852591886f2b793e).

This is **development evidence** from `qc10.quitclaim-spike-43135.testnet`, lot 2. The original MPC proof used Latest finality, and the contract still has one upgrade key. Base reaching Safe today does not upgrade that original proof. Verification relies on the published code, MPC and RPCs; it does not certify asset value or sender consent. NEAR history is read through an archival RPC.

## For maintainers

A complete passing `bun run e2e handover` writes a timestamped `reports/heist-<timestamp>.json`. It never replaces the published default automatically. Failed runs publish no candidate. Verify a final Safe candidate before promoting it:

```sh
bun run heist reports/heist-<timestamp>.json
cp reports/heist-<timestamp>.json reports/heist.json
```

Commit the verified file. Run the full Safe suite and the heist against the final deployment before freezing. Freeze remains the last contract step; afterwards, rerun the heist and check that it reports a frozen contract.

`bun run verify` includes the deterministic tests. `bun run test:heist` runs the real command in an empty home and working directory with dotenv disabled and no credential environment. Maintainer e2e creates and funds fresh lots; the judge command verifies a published run without that setup.
