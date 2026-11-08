import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { config } from "@quitclaim/shared/config.ts";
import type { ReactNode } from "react";
import { HeistReplay } from "@/components/landing/heist-replay.tsx";
import { HeroLot } from "@/components/landing/hero-lot.tsx";
import { LotCard } from "@/components/lot-card.tsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LOT_CONTRACT } from "@/lib/contract.ts";
import { frozenQuery, lotIdsQuery } from "@/lib/queries.ts";

export const Route = createFileRoute("/")({ component: Landing });

const GITHUB = "https://github.com/jaypopat/quitclaim";

function Section({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-10 border-t px-[clamp(20px,4vw,64px)] py-20">
      <h2 className="max-w-4xl text-5xl font-medium tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Panel({
  eyebrow,
  title,
  accent = false,
  href,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  accent?: boolean;
  href?: string;
  children: ReactNode;
}) {
  const body = (
    <Card className={accent ? "h-full border-primary" : "h-full"}>
      <CardContent className="flex flex-col gap-3">
        <span className="font-mono text-xs text-primary">
          {eyebrow}
          {href && " ↗"}
        </span>
        <h3 className="text-lg font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground">{children}</p>
      </CardContent>
    </Card>
  );
  return href ? (
    <a href={href} target="_blank" rel="noreferrer">
      {body}
    </a>
  ) : (
    body
  );
}

const HEIST_STEPS = [
  "A Sablier stream pays one fixed address. Alice holds its NFT title.",
  "Alice signs a withdrawal and keeps it instead of sending it.",
  "Freeze signing. Consume the outstanding nonce on Base, and NEAR checks the burn.",
  "Bob buys the NFT. The address and schedule stay the same.",
  "Alice sends the same saved withdrawal. Base rejects its used nonce.",
];

function Landing() {
  const { data: ids } = useQuery(lotIdsQuery);
  const { data: frozen } = useQuery(frozenQuery);
  const heroId = ids?.at(-1);
  return (
    <main>
      <section className="grid min-h-[calc(100dvh-4rem)] items-center gap-12 px-[clamp(20px,4vw,64px)] py-16 lg:grid-cols-2">
        <div className="flex flex-col gap-8">
          <span className="font-mono text-xs text-primary">
            BUILT ON NEAR CHAIN SIGNATURES
          </span>
          <h1 className="text-7xl font-medium tracking-tight">
            Sell a wallet. The seller keeps nothing.
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground">
            Sell your locked vesting tokens, even from a non-transferable
            stream. The stream pays one address. An NFT on NEAR is the title to
            it. Before the title moves, everything the seller signed is
            cancelled on Base.
          </p>
          <div className="flex gap-3">
            <Button asChild size="lg">
              <Link to="/market">Browse positions</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="#heist">Watch the handover ↓</a>
            </Button>
          </div>
          <div className="grid gap-6 border-t pt-6 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <span className="font-mono text-xs text-primary">
                HOLDING LOCKED TOKENS?
              </span>
              <span className="text-sm text-muted-foreground">
                Sell them now, or lease out the next month of unlocks.
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-mono text-xs text-primary">BUYING?</span>
              <span className="text-sm text-muted-foreground">
                Get future payouts at a discount, with no way for the seller to
                claw them back.
              </span>
            </div>
          </div>
        </div>
        {heroId === undefined ? (
          <Skeleton className="h-[420px]" />
        ) : (
          <HeroLot id={heroId} />
        )}
      </section>

      <Section title="Locked tokens can't be sold. Wallets can't be sold safely. NEAR can.">
        <div className="grid gap-4 md:grid-cols-3">
          <Panel
            eyebrow="01 · THE STREAM IS STUCK"
            title="Vesting streams are non-transferable."
          >
            An employer pays you over two years. The stream is bound to your
            address, so you can't sell the position or borrow against it.
          </Panel>
          <Panel
            eyebrow="02 · KEYS LEAK"
            title="Selling the private key doesn't work."
          >
            The seller can keep a copy, or sign a withdrawal now and send it
            after the sale. The buyer can never prove they didn't.
          </Panel>
          <Panel
            eyebrow="QUITCLAIM"
            title="Nobody holds a key. The locks change on sale."
            accent
          >
            NEAR's MPC network signs for the address only when the title holder
            asks. Before a sale, the seller's last signature is used up on Base,
            and NEAR checks that it was.
          </Panel>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Panel
            eyebrow="1 · CHAIN SIGNATURES"
            title="The NFT is the only key."
          >
            The address on Base is derived from the lot contract. MPC signs for
            it only when the contract asks, and the contract asks only for the
            title holder.
          </Panel>
          <Panel
            eyebrow="2 · NONCE BURN"
            title="Change the locks before the sale."
          >
            Base runs each address's transactions in order. The contract signs
            an empty transaction in the seller's next slot, so anything signed
            for that slot can never land.
          </Panel>
          <Panel
            eyebrow="3 · FOREIGN TX VERIFICATION"
            title="NEAR sees it land, then the NFT moves."
          >
            MPC confirms on NEAR that the burn is final on Base. Until then the
            title can't be listed, sold or transferred.
          </Panel>
        </div>
      </Section>

      <section
        id="heist"
        className="flex flex-col gap-10 border-t px-[clamp(20px,4vw,64px)] py-20"
      >
        <div className="grid gap-10 lg:grid-cols-2">
          <h2 className="text-5xl font-medium tracking-tight">
            Watch a sale. Then try to rob it.
          </h2>
          <ol className="flex flex-col">
            {HEIST_STEPS.map((step, i) => (
              <li key={step} className="flex gap-4 border-b py-3">
                <span className="font-mono text-xs text-muted-foreground">
                  0{i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
        <Card className="border-primary">
          <CardContent>
            <HeistReplay />
          </CardContent>
        </Card>
      </section>

      <Section title="Sell it all, or lease the unlocks.">
        <div className="grid gap-4 md:grid-cols-2">
          <Panel eyebrow="SELL" title="The buyer gets every payout left.">
            The title moves for good. The seller gets NEAR, and the original
            holder can earn a royalty on each resale.
          </Panel>
          <Panel
            eyebrow="LEASE"
            title="The lessee gets the unlocks until it ends."
          >
            They can withdraw only what vests during the lease. When it ends,
            the locks change again and control returns.
          </Panel>
        </div>
      </Section>

      <Section
        title={
          <span className="flex items-baseline justify-between gap-4">
            On the market
            <Link
              to="/market"
              className="text-sm font-normal text-muted-foreground hover:text-foreground"
            >
              See all →
            </Link>
          </span>
        }
      >
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {ids
            ? ids
                .slice(-4)
                .reverse()
                .map((id) => <LotCard key={id} id={id} />)
            : Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-96" />
              ))}
        </div>
      </Section>

      <Section title="What's real.">
        <p className="-mt-6 max-w-2xl text-muted-foreground">
          Everything here runs on NEAR testnet and Base Sepolia today. The NFT
          isn't a picture. It's a working title to a wallet.
        </p>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Panel
            eyebrow="CONTRACT"
            title="Deployed on NEAR testnet."
            href={`${config.near.explorer}/address/${LOT_CONTRACT}`}
          >
            No admin. Anyone can mint a title from a qualifying stream.
          </Panel>
          <Panel
            eyebrow="ATTACK SUITE"
            title="Adversarial end-to-end runs."
            href={`${GITHUB}/tree/master/apps/cli/src/e2e`}
          >
            Fresh lots on testnet try saved withdrawals, front-run mints,
            cancelable streams and stuck transactions.
          </Panel>
          <Panel
            eyebrow="VERIFY IT YOURSELF"
            title={<code className="font-mono">bun run heist</code>}
          >
            Checks a published sale and replays the seller's saved transaction.
            No keys, no wallet, public RPCs only.
          </Panel>
          <Panel eyebrow="SOURCE" title="Open on GitHub." href={GITHUB}>
            Rust contract, keeper and this app.{" "}
            {frozen
              ? "Every full-access key on the contract is deleted, so nobody can change it."
              : "At the end, every full-access key on the contract is deleted so nobody can change it."}
          </Panel>
        </div>
        <p className="border p-4 text-sm">
          <span className="mr-3 font-mono text-xs text-muted-foreground">
            WHAT YOU'RE TRUSTING
          </span>
          NEAR's MPC network signs and attests honestly. The lot contract is
          {frozen ? " frozen" : " frozen at the end"}. Base transactions are
          final once confirmed.
        </p>
      </Section>

      <section className="flex flex-wrap items-center justify-between gap-8 border-t px-[clamp(20px,4vw,64px)] py-24">
        <h2 className="text-5xl font-medium tracking-tight">
          Buy future payouts. Keep them.
        </h2>
        <div className="flex gap-3">
          <Button asChild size="lg">
            <Link to="/market">Browse positions</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/mint">Sell a position</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
