import type { Offer } from "@quitclaim/shared/derive.ts";
import { dayMonth, formatNear } from "@/lib/format";

/** The headline price of a lot, or what it is instead. */
export function offerPrice(offer: Offer) {
  switch (offer.kind) {
    case "sale":
      return {
        price: `${formatNear(offer.price)} NEAR`,
        note: offer.item === "Lease" ? "for the lease" : "for the title",
      };
    case "lease-offer":
      return {
        price: `${formatNear(offer.price)} NEAR`,
        note: `lease until ${dayMonth(offer.endsAtMs)}`,
      };
    case "leased":
      return { price: "Leased", note: `until ${dayMonth(offer.endsAtMs)}` };
    case "none":
      return { price: "Not for sale", note: null };
  }
}
