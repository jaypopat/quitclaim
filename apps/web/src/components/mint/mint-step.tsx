import { useQuery } from "@tanstack/react-query";
import { baseTxUrl } from "@quitclaim/shared/base.ts";
import { contractCall, MINT_DEPOSIT } from "@quitclaim/shared/calls.ts";
import { streamChecks } from "@quitclaim/shared/derive.ts";
import type { StreamCreation } from "@quitclaim/shared/sablier.ts";
import { useEffect } from "react";
import { z } from "zod";
import { ProgressBar } from "@/components/dithercn/progress-bar";
import { TitleChecks } from "@/components/lot/title-checks.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { dateTime, formatToken } from "@/lib/format";
import { mintedLotQuery, reachedQuery, tokenQuery } from "@/lib/queries.ts";
import { useSend } from "@/lib/use-send.ts";
import type { Receiving } from "./wizard.ts";

/** `mint_proven` resolves to the minted lot, or null when MPC could not attest the stream. */
const minted = z.object({ id: z.number() }).nullable().optional();

/** Waits for Base finality, then mints the title through the wallet and waits for MPC to verify. */
export function MintStep({
  owner,
  receiving,
  stream,
  onDone,
}: {
  owner: string;
  receiving: Receiving;
  stream: StreamCreation;
  onDone: (lotId: number) => void;
}) {
  const send = useSend();
  const { data: token } = useQuery(tokenQuery(stream.token));
  const { data: chain } = useQuery(reachedQuery(stream.block));
  const sent = send.isSuccess;
  const result = minted.parse(send.data?.value);
  const { data: lotId } = useQuery({
    ...mintedLotQuery(owner, receiving.path),
    enabled: sent && result !== null,
  });
  const id = result?.id ?? lotId;
  useEffect(() => {
    if (id !== undefined && id !== null) onDone(id);
  }, [id, onDone]);

  const checks = streamChecks(stream, receiving.address);
  const ok = checks.every((c) => c.status === "pass");
  const rows = [
    ["Position", receiving.name],
    [
      "Funded by your employer",
      token
        ? `${formatToken(stream.deposit, token.decimals)} ${token.symbol}`
        : "…",
    ],
    [
      "Release period",
      `${dateTime(stream.startSec * 1000)} to ${dateTime(stream.endSec * 1000)}`,
    ],
    ["Title holder", owner],
    ["Minter royalty", `${receiving.royaltyBps / 100}%`],
  ] as const;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <a
          href={baseTxUrl(`0x${stream.log.transaction_hash}`)}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          SABLIER STREAM #{String(stream.id)} ↗
        </a>
        <h2 className="text-2xl font-medium">Your stream is ready.</h2>
        <p className="text-muted-foreground">
          The stream pays your receiving address. Mint its NFT title to manage,
          sell or lease the position.
        </p>
      </div>
      <dl className="flex flex-col">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex justify-between gap-4 border-b py-2 text-sm"
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right break-all">{value}</dd>
          </div>
        ))}
      </dl>
      <TitleChecks checks={checks} title="Stream check" />
      {chain && !chain.reached && (
        <ProgressBar
          label={`Waiting for Base to reach ${chain.finality.toLowerCase()} finality for the stream's block`}
          size="sm"
        />
      )}
      <p className="text-xs text-muted-foreground">
        Minting asks MPC to verify the stream's creation log on NEAR. The
        storage deposit is 0.05 NEAR; the excess is refunded. You do not fund
        the stream.
      </p>
      {sent && result !== null ? (
        <ProgressBar label="MPC is verifying the stream" size="sm" />
      ) : (
        <Button
          disabled={!ok || !chain?.reached || send.isPending}
          onClick={() =>
            send.mutate(() =>
              contractCall(
                "mint_proven",
                {
                  name: receiving.name,
                  owner_id: owner,
                  royalty_bps: receiving.royaltyBps,
                  log: stream.log,
                },
                MINT_DEPOSIT,
              ),
            )
          }
        >
          {send.isPending
            ? "Waiting for wallet…"
            : "Verify stream & mint title"}
        </Button>
      )}
      {result === null && (
        <Alert variant="destructive">
          <AlertDescription>
            MPC could not verify the stream, so the mint rolled back and the
            deposit was refunded.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
