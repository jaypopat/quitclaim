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

The transactions: [burn](https://sepolia.basescan.org/tx/0xfea518dcfa71c8ab8be27b1ac47113e8f3f361d3d8ef88b12f63bfc444b9120f), [MPC proof](https://testnet.nearblocks.io/txns/62p8FSxwKYbkf1bUkdGrgntKrLHGWxRhTo8rGb9ALw8f), [Bob's purchase](https://testnet.nearblocks.io/txns/G7ZryHuHB7gFgLLr4uRnQo1UeKTVSfXjEHAp7V9YAjab), [Bob's withdrawal](https://sepolia.basescan.org/tx/0xb3c7d0ac1cba600f5afdcc41f45ae65ae1c5d3319f19a6ff6f3950bedfcad599). The raw signed transaction is in [reports/heist.json](reports/heist.json).

## The reverse heist

Leases run the same proof the other way. Bob leases a lot, keeps a signed transfer and resells the lease to Carol; Base rejects Bob's. Carol keeps one past expiry; the keeper seals and proves, the lease NFT burns, and Base rejects Carol's too. See the [lease e2e report](reports/e2e-lease-2026-11-11T10-40-07.039Z.md).

## Caveats

This evidence is from `quitclaim.testnet`, the final deployment: the proof used `Safe` finality, and the heist prints whether the contract still has keys. The checks prove nonce consumption, not asset value or the stream sender's consent.

## Maintainers

A passing `bun run e2e handover` writes `reports/heist-<timestamp>.json`. Check it with `bun run heist <file>`, copy it to `reports/heist.json` and commit. After `bun run freeze`, rerun the heist and confirm it reports a frozen contract.
