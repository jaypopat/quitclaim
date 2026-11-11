import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { offer } from "@quitclaim/shared/derive.ts";
import { EmptyState } from "@/components/dithercn/empty-state";
import { LotCard } from "@/components/lot-card.tsx";
import { Page } from "@/components/page.tsx";
import { Skeleton } from "@/components/ui/skeleton";
import { lotIdsQuery, lotQuery } from "@/lib/queries.ts";

export const Route = createFileRoute("/market")({ component: Market });

function Grid({ ids }: { ids: number[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
      {ids.map((id) => (
        <LotCard key={id} id={id} />
      ))}
    </div>
  );
}

function Market() {
  const { data: ids, error } = useQuery(lotIdsQuery);
  const sections = useQueries({
    queries: (ids ?? []).map(lotQuery),
    combine: (results) => {
      if (!ids || results.some((r) => r.isPending)) return undefined;
      const now = Date.now();
      const newest = ids.toReversed();
      const offered = new Set(
        results.flatMap((r) =>
          r.data && offer(r.data.lot, now).kind !== "none" ? [r.data.id] : [],
        ),
      );
      return {
        offered: newest.filter((id) => offered.has(id)),
        held: newest.filter((id) => !offered.has(id)),
      };
    },
  });
  return (
    <Page
      title="Market"
      aside="Every listing is proven clean before it can sell."
    >
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {ids?.length === 0 && (
        <EmptyState
          title="No lots yet"
          description="Mint the first title from a locked stream."
        />
      )}
      {sections ? (
        <div className="flex flex-col gap-10">
          {sections.offered.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="text-lg font-medium">On offer</h2>
              <Grid ids={sections.offered} />
            </section>
          )}
          {sections.held.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="text-lg font-medium text-muted-foreground">
                Held
              </h2>
              <Grid ids={sections.held} />
            </section>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-96" />
          ))}
        </div>
      )}
    </Page>
  );
}
