import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "@/components/dithercn/empty-state";
import { LotCard } from "@/components/lot-card.tsx";
import { Page } from "@/components/page.tsx";
import { Skeleton } from "@/components/ui/skeleton";
import { lotIdsQuery } from "@/lib/queries.ts";

export const Route = createFileRoute("/market")({ component: Market });

function Market() {
  const { data: ids, error } = useQuery(lotIdsQuery);
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
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
        {ids
          ? ids.map((id) => <LotCard key={id} id={id} />)
          : Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-96" />
            ))}
      </div>
    </Page>
  );
}
