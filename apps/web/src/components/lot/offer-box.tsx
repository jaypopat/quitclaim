import type { ReactNode } from "react";
import type { Lot } from "@quitclaim/shared";
import type { Offer } from "@quitclaim/shared/derive.ts";
import { Card, CardContent } from "@/components/ui/card";
import { dayMonth, formatNear } from "@/lib/format";

function summary(offer: Offer, lot: Lot) {
  const royalty = `Includes ${lot.royalty_bps / 100}% minter royalty.`;
  switch (offer.kind) {
    case "sale":
      return offer.item === "Lease"
        ? {
            label: "The lease is for sale",
            value: `${formatNear(offer.price)} NEAR`,
            note: `Control until the lease ends. ${royalty}`,
          }
        : {
            label: "Price",
            value: `${formatNear(offer.price)} NEAR`,
            note: royalty,
          };
    case "lease-offer":
      return {
        label: `Lease until ${dayMonth(offer.endsAtMs)}`,
        value: `${formatNear(offer.price)} NEAR`,
        note: "Withdraw what vests during the lease. The title stays with the owner.",
      };
    case "leased":
      return {
        label: `Leased to ${offer.holder}`,
        value: `until ${dayMonth(offer.endsAtMs)}`,
        note: "Control returns when the term ends and every signature is proven used.",
      };
    case "none":
      return { label: "Owner", value: lot.owner, note: "Not for sale." };
  }
}

export function OfferBox({
  offer,
  lot,
  children,
}: {
  offer: Offer;
  lot: Lot;
  children?: ReactNode;
}) {
  const { label, value, note } = summary(offer, lot);
  return (
    <Card className="min-w-0">
      <CardContent className="flex min-w-0 flex-col gap-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span
          className={`font-medium tracking-tight [overflow-wrap:anywhere] ${offer.kind === "none" ? "font-mono text-lg" : "text-3xl"}`}
        >
          {value}
        </span>
        <span className="text-sm text-muted-foreground">{note}</span>
        {children}
      </CardContent>
    </Card>
  );
}
