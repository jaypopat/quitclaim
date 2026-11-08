import { queryOptions } from "@tanstack/react-query";
import { fetchLotView } from "@quitclaim/shared/lot-view.ts";
import { settleProgress } from "@quitclaim/shared/settle-progress.ts";
import { reached, tokenInfo } from "@quitclaim/shared/base.ts";
import type { Finality } from "@quitclaim/shared/lot.gen.ts";
import {
  allTokens,
  contractFinality,
  leaseLeft,
  mintedLot,
  proceedsOf,
  tokensOf,
} from "@quitclaim/shared/lot-views.ts";
import type { Address } from "viem";
import { fullAccessKeys } from "@quitclaim/shared/near.ts";
import { LOT_CONTRACT } from "./contract.ts";

export const lotIdsQuery = queryOptions({
  queryKey: ["lot-ids", LOT_CONTRACT],
  queryFn: async () =>
    (await allTokens(LOT_CONTRACT))
      .filter((t) => t.item === "Title")
      .map((t) => t.lotId),
});

export const lotQuery = (id: number) =>
  queryOptions({
    queryKey: ["lot", LOT_CONTRACT, id],
    queryFn: () => fetchLotView(LOT_CONTRACT, id),
    refetchInterval: ({ state: { data } }) =>
      data && ["idle", "clean"].includes(settleProgress(data).phase)
        ? 15_000
        : 4_000,
  });

export const frozenQuery = queryOptions({
  queryKey: ["frozen", LOT_CONTRACT],
  queryFn: async () => (await fullAccessKeys(LOT_CONTRACT)).length === 0,
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

export const finalityQuery = queryOptions({
  queryKey: ["finality", LOT_CONTRACT],
  queryFn: () => contractFinality(LOT_CONTRACT),
  staleTime: Infinity,
});

export const tokenQuery = (token: Address) =>
  queryOptions({
    queryKey: ["token", token],
    queryFn: () => tokenInfo(token),
    staleTime: Infinity,
  });

/** Polls until Base's head at `finality` reaches `block`. */
export const reachedQuery = (block: bigint, finality: Finality) =>
  queryOptions({
    queryKey: ["reached", String(block), finality],
    queryFn: () => reached(block, finality),
    refetchInterval: ({ state: { data } }) => (data ? false : 5_000),
  });

/** Polls until the title for `path` appears in `owner`'s tokens. */
export const mintedLotQuery = (owner: string, path: string) =>
  queryOptions({
    queryKey: ["minted", LOT_CONTRACT, owner, path],
    queryFn: () => mintedLot(LOT_CONTRACT, owner, path),
    refetchInterval: ({ state: { data } }) =>
      data === undefined || data === null ? 4_000 : false,
  });
