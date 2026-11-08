import { useWalletSelector } from "@near-wallet-selector/react-hook";
import { createFileRoute, Link } from "@tanstack/react-router";
import { EmptyState } from "@/components/dithercn/empty-state";
import { Page } from "@/components/page.tsx";
import { Holdings } from "@/components/portfolio/holdings.tsx";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/portfolio")({ component: Portfolio });

function Portfolio() {
  const { signedAccountId: account, signIn } = useWalletSelector();
  return (
    <Page
      title="Portfolio"
      aside={
        account && (
          <Button asChild variant="outline">
            <Link to="/mint">+ Set up receiving address</Link>
          </Button>
        )
      }
    >
      {account ? (
        <Holdings account={account} />
      ) : (
        <EmptyState
          title="Your positions, in one place."
          description="Connect your NEAR wallet to manage your titles, leases and sale proceeds."
          illustration="folder"
          titleAs="h2"
          action={
            <div className="flex flex-col items-center gap-3">
              <Button onClick={signIn}>Connect wallet</Button>
              <Link
                to="/market"
                className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Browse market
              </Link>
            </div>
          }
        />
      )}
    </Page>
  );
}
