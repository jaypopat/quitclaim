import { queryOptions } from "@tanstack/react-query";
import { fetchLotView } from "@quitclaim/shared/lot-view.ts";
import { settleProgress } from "@quitclaim/shared/settle-progress.ts";
import { reached, tokenInfo } from "@quitclaim/shared/base.ts";
import {
  allTokens,
  contractFinality,
  getLot,
  leaseLeft,
  mintedLot,
  proceedsOf,
  tokensOf,
} from "@quitclaim/shared/lot-views.ts";
import { getAddress, type Address } from "viem";
import type { Lot } from "@quitclaim/shared/lot.gen.ts";
import { fullAccessKeys } from "@quitclaim/shared/near.ts";
import { LOT_CONTRACT } from "./contract.ts";

export const lotIdsQuery = queryOptions({
  queryKey: ["lot-ids", LOT_CONTRACT],
  queryFn: async () =>
    (await allTokens(LOT_CONTRACT))
      .filter((t) => t.item === "Title")
      .map((t) => t.lotId),
  staleTime: 60_000,
});

/** A lot as cards and lists show it: cached, never polled. */
export const lotQuery = (id: number) =>
  queryOptions({
    queryKey: ["lot", LOT_CONTRACT, id],
    queryFn: () => fetchLotView(LOT_CONTRACT, id),
  });

/** Just the NEAR record and token for the home hero: two reads instead of a full `LotView`. */
export type HeroLot = {
  lot: Lot;
  address: Address;
  token: { address: Address; symbol: string; decimals: number };
};

export const heroLotQuery = (id: number) =>
  queryOptions({
    queryKey: ["hero-lot", LOT_CONTRACT, id],
    queryFn: async (): Promise<HeroLot> => {
      const lot = await getLot(LOT_CONTRACT, id);
      if (!lot?.address) throw new Error(`lot ${id} is not minted`);
      return {
        lot,
        address: getAddress(lot.address),
        token: await tokenInfo(getAddress(lot.token)),
      };
    },
  });

/** The lot someone is looking at: polled, fast while a signature is in flight. */
export const liveLotQuery = (id: number) =>
  queryOptions({
    ...lotQuery(id),
    refetchInterval: ({ state: { data } }) =>
      data && ["idle", "clean"].includes(settleProgress(data).phase)
        ? 15_000
        : 4_000,
  });

export const frozenQuery = queryOptions({
  queryKey: ["frozen", LOT_CONTRACT],
  queryFn: async () => (await fullAccessKeys(LOT_CONTRACT)).length === 0,
  staleTime: 5 * 60_000,
});

export const holdingsQuery = (account: string) =>
  queryOptions({
    queryKey: ["holdings", LOT_CONTRACT, account],
    queryFn: () => tokensOf(LOT_CONTRACT, account),
  });

export const proceedsQuery = (account: string) =>
  queryOptions({
    queryKey: ["proceeds", LOT_CONTRACT, account],
    queryFn: () => proceedsOf(LOT_CONTRACT, account),
  });

export const leaseLeftQuery = (id: number) =>
  queryOptions({
    queryKey: ["lease-left", LOT_CONTRACT, id],
    queryFn: () => leaseLeft(LOT_CONTRACT, id),
  });

export const tokenQuery = (token: Address) =>
  queryOptions({
    queryKey: ["token", token],
    queryFn: () => tokenInfo(token),
    staleTime: Infinity,
  });

/** Polls until Base's head reaches `block` at the finality the lot contract's MPC proofs use. */
export const reachedQuery = (block: bigint) =>
  queryOptions({
    queryKey: ["reached", LOT_CONTRACT, String(block)],
    queryFn: async () => {
      const finality = await contractFinality(LOT_CONTRACT);
      return { finality, reached: await reached(block, finality) };
    },
    refetchInterval: ({ state: { data } }) => (data?.reached ? false : 5_000),
  });

/** The title minted for `path` in `owner`'s tokens, if any. */
export const mintedLotQuery = (owner: string, path: string) =>
  queryOptions({
    queryKey: ["minted", LOT_CONTRACT, owner, path],
    queryFn: () => mintedLot(LOT_CONTRACT, owner, path),
  });
