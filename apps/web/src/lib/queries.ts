import { queryOptions } from "@tanstack/react-query";
import { fetchLotView } from "@quitclaim/shared/lot-view.ts";
import { allTokens } from "@quitclaim/shared/lot-views.ts";
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
    refetchInterval: 15_000,
  });

export const frozenQuery = queryOptions({
  queryKey: ["frozen", LOT_CONTRACT],
  queryFn: async () => (await fullAccessKeys(LOT_CONTRACT)).length === 0,
});
