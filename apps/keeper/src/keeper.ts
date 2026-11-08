/**
 * Settles every lot with unproven txs or a run-out lease. Every action is permissionless on chain,
 * so anyone can run one.
 *
 *   bun run keeper            settle once
 *   bun run keeper --watch    keep settling
 */
import { env } from "@quitclaim/sdk/env.ts";
import { mustLot } from "@quitclaim/sdk/lot.ts";
import { logger } from "@quitclaim/sdk/logger.ts";
import { view } from "@quitclaim/sdk/near.ts";
import { settle } from "@quitclaim/sdk/settle.ts";
import { leaseRunOut } from "@quitclaim/shared/control.ts";

const PAGE_SIZE = 100;

/**
 * Lots with a signed tx the contract hasn't seen proven yet, or a lease that has run out. All are
 * found before any is settled, because settling closes leases, which shrinks the enumeration under
 * a later page's offset. A lease token (`<id>-lease`) shares its lot with the title, so only titles
 * are inspected.
 */
async function pending(contract: string) {
  const found: number[] = [];
  let offset = 0n;
  for (;;) {
    const tokens = await view(contract, "nft_tokens", {
      from_index: offset.toString(),
      limit: PAGE_SIZE,
    });
    const ids = tokens
      .filter((token) => /^\d+$/.test(token.token_id))
      .map((token) => Number(token.token_id));
    const lots = await Promise.all(ids.map((id) => mustLot(contract, id)));
    found.push(
      ...ids.filter((_, i) => {
        const lot = lots[i]!;
        return (
          lot.issued.some((t) => t.tx_hash) || leaseRunOut(lot, Date.now())
        );
      }),
    );
    if (tokens.length < PAGE_SIZE) return found;
    offset += BigInt(tokens.length);
  }
}

if (import.meta.main) {
  const contract = env.lotContract();
  const prover = env.keeper();
  const watch = Bun.argv.includes("--watch");
  const log = logger.child({ command: "keeper", contract });
  do {
    for (const id of await pending(contract)) {
      try {
        const r = await settle(contract, prover, id);
        log.info(
          {
            lot: id,
            state: r.lot.state,
            nextNonce: r.lot.next_nonce,
            proven: r.proven,
            reverted: r.reverted,
          },
          "Settlement completed",
        );
      } catch (err) {
        log.error({ err, lot: id }, "Settlement failed");
      }
    }
    if (watch) await Bun.sleep(30_000);
  } while (watch);
}
