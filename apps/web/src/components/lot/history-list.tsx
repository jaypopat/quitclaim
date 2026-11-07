import type { HistoryEntry } from "@quitclaim/shared/derive.ts";
import { baseTxUrl } from "@quitclaim/shared/base.ts";
import { dayMonth, formatNear, formatToken, shortAddress } from "@/lib/format";

type Token = { symbol: string; decimals: number };

function describe(entry: HistoryEntry, token: Token) {
  switch (entry.kind) {
    case "listed":
      return `Listed the ${entry.item === "Lease" ? "lease" : "title"} at ${formatNear(entry.price)} NEAR`;
    case "lease-offered":
      return `Offered for lease until ${dayMonth(entry.endsAtMs)} at ${formatNear(entry.price)} NEAR`;
    case "issued": {
      const { kind, nonce, tx_hash } = entry.issued;
      const what =
        kind === "Burn"
          ? "Burn"
          : `Transfer of ${formatToken(BigInt(kind.Transfer.amount), token.decimals)} ${token.symbol} to ${shortAddress(kind.Transfer.to)}`;
      return `${what} at nonce ${nonce}, ${tx_hash ? "signed" : "awaiting MPC"}`;
    }
    case "leased":
      return `Leased to ${entry.holder} until ${dayMonth(entry.endsAtMs)}`;
    case "proven":
      return entry.through === 0
        ? "Nonce 0 proven consumed on Base"
        : `Nonces 0 to ${entry.through} proven consumed on Base`;
    case "stream-started":
      return "Stream started paying the address";
  }
}

const when = (entry: HistoryEntry) =>
  entry.kind === "leased" || entry.kind === "stream-started"
    ? dayMonth(entry.atMs)
    : entry.kind === "proven"
      ? ""
      : "now";

export function HistoryList({
  entries,
  token,
}: {
  entries: HistoryEntry[];
  token: Token;
}) {
  return (
    <section className="flex flex-col">
      <header className="flex items-baseline justify-between border-b pb-3">
        <h2 className="text-lg font-medium">History</h2>
        <span className="font-mono text-xs text-muted-foreground">
          from contract state
        </span>
      </header>
      <ol>
        {entries.map((entry, i) => {
          const tx = entry.kind === "issued" ? entry.issued.tx_hash : null;
          return (
            <li key={i} className="flex gap-4 border-b py-3 text-sm">
              <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
                {when(entry)}
              </span>
              <span className="flex flex-col gap-1">
                {describe(entry, token)}
                {tx && (
                  <a
                    href={baseTxUrl(tx)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  >
                    {shortAddress(tx)} on Base ↗
                  </a>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
