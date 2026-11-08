import { fetchLotAddress } from "@quitclaim/shared/address.ts";
import { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { LOT_CONTRACT } from "@/lib/contract.ts";
import { useAppForm } from "@/lib/form.tsx";
import { lotName, royaltyBps } from "@/lib/inputs.ts";
import type { Receiving } from "./wizard.ts";

const position = z.object({ name: lotName, royalty: royaltyBps });

/** Names the position and derives the Base address its stream must pay. */
export function AddressStep({
  minter,
  onDone,
}: {
  minter: string;
  onDone: (receiving: Receiving) => void;
}) {
  const form = useAppForm({
    defaultValues: { name: "", royalty: "2.5" },
    validators: { onChange: position },
    onSubmit: async ({ value }) => {
      const { name, royalty } = position.parse(value);
      const path = `${minter}/${name}`;
      onDone({
        name,
        royaltyBps: royalty,
        path,
        address: await fetchLotAddress(LOT_CONTRACT, path),
      });
    },
  });
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-medium">Where your stream will pay.</h2>
        <p className="text-muted-foreground">
          Set up a receiving address to share with your employer. They fund the
          stream and choose its amount and schedule.
        </p>
      </div>
      <FieldGroup>
        <form.AppField name="name">
          {(field) => (
            <field.TextField
              label="Name this position"
              placeholder="team-allocation"
              autoComplete="off"
              description={`${minter}/${field.state.value || "…"}`}
            />
          )}
        </form.AppField>
        <form.AppField name="royalty">
          {(field) => (
            <field.TextField
              label="Minter royalty (%)"
              inputMode="decimal"
              description="0 to 10%. Paid to you on Quitclaim sales and fixed at mint. Direct transfers pay no royalty."
            />
          )}
        </form.AppField>
      </FieldGroup>
      <Alert>
        <AlertDescription>
          Arrange this before the stream is created. A stream already paying
          your ordinary wallet cannot be moved here.
        </AlertDescription>
      </Alert>
      <form.Subscribe selector={(s) => s.isSubmitting}>
        {(submitting) => (
          <Button type="submit" disabled={submitting}>
            {submitting
              ? "Asking MPC for the address…"
              : "Generate receiving address →"}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
