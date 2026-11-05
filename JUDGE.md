# Can Alice steal the money back?

Alice owned a Base address receiving a Sablier stream. Before selling its title to Bob, she signed a withdrawal to herself and kept it. Quitclaim burned that nonce before the sale, and NEAR MPC proved the burn.

## Run the heist

```sh
bun install
bun run heist
```

No wallet, keys, `.env` or funds. The command checks the published handover against public chain data, then broadcasts Alice's withdrawal once. It signs nothing. Expect:

```text
Base rejected it: nonce too low: next nonce 3, tx nonce 1
PASS Alice's retained withdrawal was rejected. Current owner: carol.quitclaim-spike-43135.testnet.
```

It exits zero only if every check passes and Base rejects the spent nonce.

## What it checks

1. Alice's signature is a token withdrawal from this lot to herself.
2. A successful burn consumed the same nonce on Base.
3. NEAR MPC verified that burn, and the contract accepted the proof.
4. Bob bought the title, then withdrew from the same address to himself.

The transactions: [burn](https://sepolia.basescan.org/tx/0x1155eba522eb8bfc47fc7f4ad69782566131078ca87b2421f7de30455f933499), [MPC proof](https://testnet.nearblocks.io/txns/HyjkRYt84RQcbDdjiqTHun83mkz8op4RgUrHWaG7KPJw), [Bob's purchase](https://testnet.nearblocks.io/txns/AS4Do5zxZATgCeBpFxEpAXRDch4QgdqwkW2c4Hequ3XA), [Bob's withdrawal](https://sepolia.basescan.org/tx/0xc59f41515b1af3d8674f1cd20ff512d2bd2057052eb5070f852591886f2b793e). The raw signed transaction is in [reports/heist.json](reports/heist.json).

## The reverse heist

Leases run the same proof the other way. Bob leases a lot, keeps a signed transfer and resells the lease to Carol; Base rejects Bob's. Carol keeps one past expiry; the keeper seals and proves, the lease NFT burns, and Base rejects Carol's too. See the [lease e2e report](reports/e2e-lease-2026-11-05T22-25-18.193Z.md).

## Caveats

This is development evidence from `qc10.quitclaim-spike-43135.testnet`, lot 2: the proof used `Latest` finality and the contract still has an upgrade key. The final deployment will prove at `Safe` and have its keys deleted, and the heist reports which it is. The checks prove nonce consumption, not asset value or the stream sender's consent.

## Maintainers

A passing `bun run e2e handover` writes `reports/heist-<timestamp>.json`. Check it with `bun run heist <file>`, copy it to `reports/heist.json` and commit. After `bun run freeze`, rerun the heist and confirm it reports a frozen contract.
