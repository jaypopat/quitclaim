import { createServerFn } from "@tanstack/react-start";
import { createStream, pull } from "@quitclaim/sdk/sablier.ts";
import { fetchLotAddress } from "@quitclaim/shared/address.ts";
import { getLot, holdsTestUsdc } from "@quitclaim/shared/lot-views.ts";
import { getAddress } from "viem";
import { z } from "zod";
import { LOT_CONTRACT } from "./contract.ts";
import { lotName, nearAccount } from "./inputs.ts";

/**
 * An example employer stream: 5 test USDC over a day from the funder, so a lease has something to
 * vest. It pays only the lot address the contract derives for `<minter>/<name>`, never an address
 * the caller names.
 */
export const demoStream = createServerFn({ method: "POST" })
  .validator(z.object({ minter: nearAccount, name: lotName }))
  .handler(async ({ data }) => {
    const address = await fetchLotAddress(
      LOT_CONTRACT,
      `${data.minter}/${data.name}`,
    );
    const { tx } = await createStream(
      getAddress(address),
      5n * 10n ** 6n,
      86_400,
    );
    return tx;
  });

/** Moves what has vested into the lot. Sablier lets anyone do this; the funder pays the gas and fee. */
export const pullStream = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.number().int().nonnegative() }))
  .handler(async ({ data }) => {
    const lot = await getLot(LOT_CONTRACT, data.id);
    if (!lot?.address || !holdsTestUsdc(lot))
      throw new Error(`lot ${data.id} is not a test USDC lot`);
    return pull(BigInt(lot.source.id), getAddress(lot.address));
  });
