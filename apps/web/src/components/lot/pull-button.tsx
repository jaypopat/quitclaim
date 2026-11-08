import { useMutation, useQueryClient } from "@tanstack/react-query";
import { baseTxUrl } from "@quitclaim/shared/base.ts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { pullStream } from "@/lib/streams.functions.ts";

/** Anyone may move what has vested from the stream into the lot; nobody needs a Base wallet for it. */
export function PullButton({ id, label }: { id: number; label: string }) {
  const queryClient = useQueryClient();
  const pull = useMutation({
    mutationFn: () => pullStream({ data: { id } }),
    onSuccess: (tx) => {
      toast.success(
        tx ? "Pulled into the address" : "Nothing new has vested yet",
        tx
          ? {
              action: {
                label: "View",
                onClick: () => window.open(baseTxUrl(tx)),
              },
            }
          : undefined,
      );
      return queryClient.invalidateQueries();
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <Button
      variant="outline"
      disabled={pull.isPending}
      onClick={() => pull.mutate()}
    >
      {pull.isPending ? "Pulling on Base…" : label}
    </Button>
  );
}
