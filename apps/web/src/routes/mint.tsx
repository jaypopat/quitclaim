import { useWallet } from "@/lib/wallet.tsx";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useState, useEffect } from "react";
import { toast } from "sonner";
import { restoreWizard, saveWizard } from "@/lib/mint-recovery.ts";
import { EmptyState } from "@/components/dithercn/empty-state";
import { ProgressBar } from "@/components/dithercn/progress-bar";
import { AddressStep } from "@/components/mint/address-step.tsx";
import { MintStep } from "@/components/mint/mint-step.tsx";
import { StreamStep } from "@/components/mint/stream-step.tsx";
import { STEPS, type Wizard } from "@/components/mint/wizard.ts";
import { Page } from "@/components/page.tsx";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/mint")({ component: Mint });

const STAGE: Record<Wizard["step"], number> = {
  address: 1,
  stream: 2,
  mint: 3,
  done: 3,
};

function Mint() {
  const { signedAccountId: account } = useWallet();
  return <MintSession key={account} />;
}

function MintSession() {
  const { signedAccountId: account, signIn } = useWallet();
  const [wizard, updateWizard] = useState<Wizard>({ step: "address" });
  const setWizard: typeof updateWizard = (next) =>
    updateWizard((previous) => {
      const value = typeof next === "function" ? next(previous) : next;
      if (account) saveWizard(account, value);
      return value;
    });
  const [restoring, setRestoring] = useState(true);
  useEffect(() => {
    let active = true;
    if (!account) {
      setRestoring(false);
      return;
    }
    void restoreWizard(account)
      .then((value) => {
        if (active) updateWizard(value);
      })
      .catch((error) => {
        if (active) toast.error(`Mint recovery: ${error.message}`);
      })
      .finally(() => {
        if (active) setRestoring(false);
      });
    return () => {
      active = false;
    };
  }, [account]);
  const minted = useCallback(
    (lotId: number) =>
      setWizard((w) =>
        w.step === "mint" ? { step: "done", receiving: w.receiving, lotId } : w,
      ),
    [account],
  );

  if (!account)
    return (
      <Page title="Set up receiving address">
        <EmptyState
          title="Mint a title for a stream that pays you."
          description="Connect your NEAR wallet. The title's address is derived from your account."
          illustration="planet"
          titleAs="h2"
          action={<Button onClick={signIn}>Connect wallet</Button>}
        />
      </Page>
    );

  if (restoring)
    return <Page title="Restoring your mint…">Reading your saved stream.</Page>;
  const stage = STAGE[wizard.step];
  return (
    <Page title="Set up receiving address">
      <div className="flex max-w-xl flex-col gap-8">
        <ProgressBar
          label={`${stage} · ${STEPS[stage - 1]}`}
          value={wizard.step === "done" ? STEPS.length : stage - 1}
          max={STEPS.length}
          valueText={`Step ${stage} of ${STEPS.length}`}
          segments={STEPS.length}
          size="sm"
        />
        {wizard.step === "address" && (
          <AddressStep
            minter={account}
            onDone={(receiving) => setWizard({ step: "stream", receiving })}
          />
        )}
        {wizard.step === "stream" && (
          <StreamStep
            minter={account}
            receiving={wizard.receiving}
            onDone={(stream) =>
              setWizard({ step: "mint", receiving: wizard.receiving, stream })
            }
          />
        )}
        {wizard.step === "mint" && (
          <MintStep
            owner={account}
            receiving={wizard.receiving}
            stream={wizard.stream}
            onDone={minted}
          />
        )}
        {wizard.step === "done" && (
          <div className="flex flex-col gap-4">
            <span className="font-mono text-xs text-muted-foreground">
              NFT TITLE CREATED
            </span>
            <h2 className="text-2xl font-medium">
              {wizard.receiving.name} is yours.
            </h2>
            <p className="text-muted-foreground">
              Your employer-funded stream now has a title. It controls the
              address the stream pays.
            </p>
            <Button asChild>
              <Link to="/lot/$id" params={{ id: wizard.lotId }}>
                View your position →
              </Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => setWizard({ step: "address" })}
            >
              Set up another receiving address
            </Button>
          </div>
        )}
      </div>
    </Page>
  );
}
