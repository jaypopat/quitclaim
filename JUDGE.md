# Verify the retained-signature heist

After `bun install`, run from the repository root:

```sh
bun run heist
```

No wallet, private key, `.env`, credentials directory, or funds are required. The command checks a recorded handover using public NEAR and Base Sepolia RPCs, then broadcasts the published signed transaction once after verifying nonce consumption. It sends no NEAR transactions and signs nothing.

The expected final line is:

```text
PASS replay rejected for consumed nonce: nonce too low: next nonce 3, tx nonce 1
```

The current nonce and RPC wording can change. Exit zero requires a specific used-nonce rejection. A timeout, generic rejection, already-known response, accepted transaction, or unavailable mandatory receipt produces `INCOMPLETE heist` and a nonzero exit. All prerequisite checks must pass before replay.

## What is verified live

- The retained EIP-1559 signature recovers to the lot address, uses Base Sepolia, and transfers the lot's fixed token to the seller. Destination and amount are decoded from the signed bytes.
- The live lot and independently derived MPC address agree with the evidence. Both NEAR and Base report the nonce consumed. The deployed code hash and configured finality match the evidence.
- The consuming transaction is a successful, canonical self-transfer at that nonce. Its block has now reached Base Safe finality.
- The NEAR proof calls MPC for that consuming hash and has a successful nonce-proof callback for this lot.
- The NEAR purchase succeeded and emitted the matching seller-to-buyer title transfer.
- The buyer's subsequent canonical withdrawal paid tokens from the same lot, with matching calldata and token event.

The optional historical nonce check shows that nonce 1 was unused immediately before the consuming block. Unavailable historical state is labelled `UNAVAILABLE`; a served value that contradicts the claim fails. Missing mandatory proof or sale receipts prevent replay and a full pass. Republish fresh evidence if the RPC no longer serves its history.

The lot may have been resold after the recorded handover. The example now belongs to Carol and is Active. Its retained nonce remains consumed.

## Published development evidence

[heist.json](reports/heist.json) contains the signed bytes and references from the [passing handover report](reports/e2e-handover-2026-11-05T13-09-25.264Z.md).

The example is contract `qc10.quitclaim-spike-43135.testnet`, lot 2, recorded November 5, 2026. Its recorded MPC finality is **Latest**. This is development evidence, not the final Safe demonstration. The consuming Base block reaching Safe today does not change the finality of the original MPC proof.

The historical full-access key count was not captured. The command reads the current count, which was **1** when this guide was verified. This deployment remains upgradeable. It displays recorded and current policy separately. Verification depends on the published code, honest MPC attestation and public RPC data. It does not certify asset value, sender consent, or off-chain rights.

Inspect the public transactions:

- [Nonce-consuming burn on Base](https://sepolia.basescan.org/tx/0x1155eba522eb8bfc47fc7f4ad69782566131078ca87b2421f7de30455f933499).
- [NEAR proof](https://testnet.nearblocks.io/txns/HyjkRYt84RQcbDdjiqTHun83mkz8op4RgUrHWaG7KPJw).
- [NEAR purchase](https://testnet.nearblocks.io/txns/AS4Do5zxZATgCeBpFxEpAXRDch4QgdqwkW2c4Hequ3XA).
- [Buyer's withdrawal on Base](https://sepolia.basescan.org/tx/0xc59f41515b1af3d8674f1cd20ff512d2bd2057052eb5070f852591886f2b793e).

## Publish final evidence

Maintainers run the funded `bun run e2e handover` against the final Safe contract. Only a complete passing run writes a timestamped `reports/heist-<timestamp>.json` beside its Markdown report. Failed runs leave the published default untouched.

Verify a candidate, then copy that exact passing file to `reports/heist.json` and commit it:

```sh
bun run heist reports/heist-<timestamp>.json
cp reports/heist-<timestamp>.json reports/heist.json
```

Keep candidates for upgraded deployments separate. The verifier requires the recorded code hash to match the currently deployed code. Run the full Safe suite and this command against the final deployment before freezing. Freeze remains the final contract step. Afterwards, run the command again and check that the current full-access key count is zero.

## Local and live checks

`bun run verify` includes deterministic malformed-evidence, signature-binding, nonce-gating, receipt-binding and replay-outcome tests.

`bun run test:heist` runs the real public replay in a temporary empty home and working directory, with dotenv disabled and no credential environment. It needs network access and remains separate from deterministic verification.

The maintainer e2e suite creates streams, signs transactions, and spends testnet funds. Judges use `heist` to verify existing evidence without that setup.
