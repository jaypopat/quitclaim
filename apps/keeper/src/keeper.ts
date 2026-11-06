/**
 * Settles every lot with unproven txs or a run-out lease. Every action is permissionless on chain,
 * so anyone can run one.
 *
 *   bun run keeper            settle once
 *   bun run keeper --watch    keep settling
 */
import { env } from "@quitclaim/chain/env.ts";
import { leaseRunOut, mustLot } from "@quitclaim/chain/lot.ts";
import { logger } from "@quitclaim/chain/logger.ts";
import { view } from "@quitclaim/chain/near.ts";
import { settle } from "@quitclaim/chain/settle.ts";
import { pendingLots } from "./pending.ts";

/** Lots with a signed tx the contract hasn't seen proven yet, or a lease that has run out. */
function pending(contract: string) {
  return pendingLots(
    (from_index, limit) => view(contract, "nft_tokens", { from_index, limit }),
    async (id) => {
      const lot = await mustLot(contract, id);
      return lot.issued.some((i) => i.tx_hash) || leaseRunOut(lot);
    },
  );
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
