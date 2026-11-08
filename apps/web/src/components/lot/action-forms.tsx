import type { LotAction } from "@quitclaim/shared/actions.ts";
import { estimateTransferGas, floorFees } from "@quitclaim/shared/base.ts";
import type { LotView } from "@quitclaim/shared/lot-view.ts";
import { useQuery } from "@tanstack/react-query";
import { leaseLeftQuery } from "@/lib/queries.ts";
import { getAddress } from "viem";
import { z } from "zod";
import { useAppForm } from "@/lib/form.tsx";
import {
  evmAddress,
  futureDate,
  nearAmount,
  tokenAmount,
} from "@/lib/inputs.ts";
import type { useSend } from "@/lib/use-send.ts";
import { ActionDialog } from "./action-dialog.tsx";

type Send = ReturnType<typeof useSend>;
type Of<K extends LotAction["kind"]> = Extract<LotAction, { kind: K }>;

const listing = z.object({ price: nearAmount });

export function ListForm({ action, send }: { action: Of<"list">; send: Send }) {
  const form = useAppForm({
    defaultValues: { price: "" },
    validators: { onChange: listing },
    onSubmit: ({ value }) =>
      send.mutate(() => action.call(listing.parse(value).price)),
  });
  return (
    <ActionDialog
      label="List for sale"
      description="Anyone can buy at this price while the lot stays Clean. The minter's royalty comes out of it."
      pending={send.isPending}
      onSubmit={form.handleSubmit}
    >
      <form.AppField name="price">
        {(field) => (
          <field.TextField label="Price in NEAR" inputMode="decimal" />
        )}
      </form.AppField>
    </ActionDialog>
  );
}

const leaseOffer = z.object({ price: nearAmount, endsAt: futureDate });

export function OfferLeaseForm({
  action,
  send,
}: {
  action: Of<"offer-lease">;
  send: Send;
}) {
  const form = useAppForm({
    defaultValues: { price: "", endsAt: "" },
    validators: { onChange: leaseOffer },
    onSubmit: ({ value }) => {
      const { price, endsAt } = leaseOffer.parse(value);
      send.mutate(() => action.call({ price, endsAtMs: endsAt }));
    },
  });
  return (
    <ActionDialog
      label="Offer a lease"
      description="The lessee controls the lot until the end date and can withdraw only what vests in that time. The title stays yours."
      pending={send.isPending}
      onSubmit={form.handleSubmit}
    >
      <form.AppField name="price">
        {(field) => (
          <field.TextField label="Price in NEAR" inputMode="decimal" />
        )}
      </form.AppField>
      <form.AppField name="endsAt">
        {(field) => <field.TextField label="Ends" type="datetime-local" />}
      </form.AppField>
    </ActionDialog>
  );
}

export function WithdrawForm({
  action,
  view,
  send,
}: {
  action: Of<"withdraw">;
  view: LotView;
  send: Send;
}) {
  const { token, address, base } = view;
  const budget = useQuery({
    ...leaseLeftQuery(view.id),
    enabled: !!view.lot.lease,
    refetchInterval: 4_000,
  });
  const prior = view.lot.issued.reduce(
    (max, issued) =>
      issued.nonce === view.lot.next_nonce && typeof issued.kind === "object"
        ? BigInt(issued.kind.Transfer.amount) > max
          ? BigInt(issued.kind.Transfer.amount)
          : max
        : max,
    0n,
  );
  const allowed = view.lot.lease ? (budget.data ?? 0n) + prior : base.held;
  const maximum = allowed < base.held ? allowed : base.held;
  const withdrawal = z.object({
    to: evmAddress,
    amount: tokenAmount(token.decimals, maximum),
  });
  const form = useAppForm({
    defaultValues: { to: "", amount: "" },
    validators: { onChange: withdrawal },
    onSubmit: ({ value }) => {
      const parsed = withdrawal.parse(value);
      const to = getAddress(parsed.to);
      send.mutate(async () => {
        const [gas, floor] = await Promise.all([
          estimateTransferGas(token.address, address, to, parsed.amount),
          floorFees(),
        ]);
        return action.call({
          to,
          amount: parsed.amount,
          gasLimit: Number(gas),
          floor,
        });
      });
    },
  });
  return (
    <ActionDialog
      label="Send to a Base address"
      description={`MPC signs a ${token.symbol} transfer from the lot address. The keeper broadcasts it and proves it landed.`}
      pending={send.isPending}
      onSubmit={form.handleSubmit}
    >
      <form.AppField name="to">
        {(field) => (
          <field.TextField label="To (Base address)" placeholder="0x…" />
        )}
      </form.AppField>
      <form.AppField name="amount">
        {(field) => (
          <field.TextField
            label={`Amount in ${token.symbol}`}
            inputMode="decimal"
          />
        )}
      </form.AppField>
    </ActionDialog>
  );
}
