import type { ReactNode } from "react";

function Column({
  eyebrow,
  accent,
  items,
}: {
  eyebrow: string;
  accent?: boolean;
  items: [string, ReactNode][];
}) {
  return (
    <div
      className={`flex flex-col gap-4 border p-6 ${accent ? "border-primary" : ""}`}
    >
      <span
        className={`font-mono text-xs ${accent ? "text-primary" : "text-muted-foreground"}`}
      >
        {eyebrow}
      </span>
      <ul className="flex flex-col">
        {items.map(([who, why]) => (
          <li
            key={who}
            className="grid gap-1 border-t py-3 sm:grid-cols-[10rem_1fr] sm:gap-4"
          >
            <span className="font-medium">{who}</span>
            <span className="text-sm text-pretty text-muted-foreground">
              {why}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Who a buyer has to trust, and who they don't. */
export function TrustModel({ frozen }: { frozen: boolean }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Column
        eyebrow="YOU DON'T TRUST"
        accent
        items={[
          [
            "The seller",
            "Anything they signed is burned on Base and proven before the title moves.",
          ],
          [
            "The keeper",
            "Gas top-ups, broadcasts and proofs are permissionless. Anyone can run them.",
          ],
          [
            "An admin",
            "There is none. Anyone can mint from a qualifying stream.",
          ],
        ]}
      />
      <Column
        eyebrow="YOU DO TRUST"
        items={[
          [
            "NEAR's MPC network",
            "Signs only what the contract asks, and attests honestly to what landed on Base.",
          ],
          [
            "The lot contract",
            frozen
              ? "Frozen. Every full-access key is deleted."
              : "Frozen at the end, when every full-access key is deleted.",
          ],
          [
            "Base finality",
            "A burn counts once Base reaches the finality the contract checks.",
          ],
          [
            "Tidepool",
            "Cash-out only. Its custodial relayer delivers test wNEAR or refunds the lot.",
          ],
        ]}
      />
    </div>
  );
}
