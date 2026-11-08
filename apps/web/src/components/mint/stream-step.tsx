import { useMutation } from "@tanstack/react-query";
import {
  fetchStreamCreation,
  type StreamCreation,
} from "@quitclaim/shared/sablier.ts";
import { isAddressEqual, type Hex } from "viem";
import { z } from "zod";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { useAppForm } from "@/lib/form.tsx";
import { txHash } from "@/lib/inputs.ts";
import { demoStream } from "@/lib/streams.functions.ts";
import type { Receiving } from "./wizard.ts";

const employerTx = z.object({ tx: txHash });

/** Shares the receiving address, then reads the employer's stream from its creation transaction. */
export function StreamStep({
  minter,
  receiving,
  onDone,
}: {
  minter: string;
  receiving: Receiving;
  onDone: (stream: StreamCreation) => void;
}) {
  const check = useMutation({
    mutationFn: async (tx: Hex) => {
      const stream = await fetchStreamCreation(tx);
      if (!isAddressEqual(stream.recipient, receiving.address))
        throw new Error(
          `This stream pays ${stream.recipient}, not your receiving address.`,
        );
      return stream;
    },
    onSuccess: onDone,
  });
  const example = useMutation({
    mutationFn: async () =>
      fetchStreamCreation(
        await demoStream({ data: { minter, name: receiving.name } }),
      ),
    onSuccess: onDone,
  });
  const form = useAppForm({
    defaultValues: { tx: "" },
    validators: { onChange: employerTx },
    onSubmit: ({ value }) => check.mutate(employerTx.parse(value).tx),
  });
  const busy = check.isPending || example.isPending;
  const error = check.error ?? example.error;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-medium">Send this to your employer.</h2>
        <p className="text-muted-foreground">
          Ask them to use this address as the recipient when creating your
          Sablier stream.
        </p>
      </div>
      <Card>
        <CardContent className="flex flex-col gap-3">
          <span className="text-xs text-muted-foreground">
            Receiving address · Base Sepolia
          </span>
          <span className="font-mono text-sm break-all">
            {receiving.address}
          </span>
          <Button
            variant="outline"
            onClick={() =>
              navigator.clipboard
                .writeText(receiving.address)
                .then(() => toast.success("Address copied"))
            }
          >
            Copy address
          </Button>
          <span className="text-xs text-muted-foreground">
            Sablier Lockup v4 · Base Sepolia · test USDC
          </span>
          <span className="flex gap-2">
            <Badge variant="outline">Non-cancelable</Badge>
            <Badge variant="outline">Non-transferable</Badge>
          </span>
        </CardContent>
      </Card>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <h3 className="font-medium">Has your employer created the stream?</h3>
        <FieldGroup>
          <form.AppField name="tx">
            {(field) => (
              <field.TextField
                label="Stream creation transaction"
                placeholder="0x…"
                autoComplete="off"
                description="Paste the Base transaction hash from your employer."
              />
            )}
          </form.AppField>
        </FieldGroup>
        <Button type="submit" disabled={busy}>
          {check.isPending ? "Reading the stream…" : "Check the stream →"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => example.mutate()}
        >
          {example.isPending
            ? "Creating a 5 USDC stream on Base…"
            : "Use an example employer-funded stream"}
        </Button>
      </form>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
