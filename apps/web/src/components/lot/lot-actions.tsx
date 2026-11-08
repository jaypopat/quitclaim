import { useWalletSelector } from "@near-wallet-selector/react-hook";
import { actions, type LotAction } from "@quitclaim/shared/actions.ts";
import { floorFees } from "@quitclaim/shared/base.ts";
import type { LotView } from "@quitclaim/shared/lot-view.ts";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now.ts";
import { formatNear } from "@/lib/format.ts";
import { useSend } from "@/lib/use-send.ts";
import { ListForm, OfferLeaseForm, WithdrawForm } from "./action-forms.tsx";

const LABEL: Record<LotAction["kind"], string> = {
  buy: "Buy",
  "take-lease": "Take the lease",
  delist: "Withdraw the offer",
  unseal: "Unseal",
  "surrender-lease": "Surrender the lease",
  "end-lease": "End the lease",
  seal: "Seal",
  list: "List for sale",
  "offer-lease": "Offer a lease",
  withdraw: "Withdraw",
};

/** Every action the viewer may take now, from the shared `actions` table. */
export function LotActions({ view }: { view: LotView }) {
  const { signedAccountId: account, signIn } = useWalletSelector();
  const now = useNow();
  const send = useSend();
  const available = actions(view, account, now);
  if (!available.length) return null;
  if (!account)
    return (
      <Button onClick={signIn}>
        Connect to {LABEL[available[0]!.kind].toLowerCase()}
      </Button>
    );

  return (
    <div className="flex flex-col gap-2">
      {available.map((action) => {
        switch (action.kind) {
          case "list":
            return <ListForm key="list" action={action} send={send} />;
          case "offer-lease":
            return <OfferLeaseForm key="lease" action={action} send={send} />;
          case "withdraw":
            return (
              <WithdrawForm
                key="withdraw"
                action={action}
                view={view}
                send={send}
              />
            );
          case "seal":
            return (
              <Button
                key="seal"
                variant="outline"
                disabled={send.isPending}
                onClick={() =>
                  send.mutate(async () => action.call(await floorFees()))
                }
              >
                {LABEL.seal}
              </Button>
            );
          default:
            return (
              <Button
                key={action.kind}
                variant={action.kind === "buy" ? "default" : "outline"}
                disabled={send.isPending}
                onClick={() => send.mutate(() => action.call)}
              >
                {LABEL[action.kind]}
                {action.call.deposit > 1n &&
                  ` · ${formatNear(action.call.deposit)} NEAR`}
              </Button>
            );
        }
      })}
    </div>
  );
}
