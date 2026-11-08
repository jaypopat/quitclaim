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
  const heroId = ids?.at(0);
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

      <Section title="A stream stays put. Its title can move.">
        <div className="grid gap-12 lg:grid-cols-[1fr_2fr]">
          <div className="flex flex-col gap-6">
            <p className="text-xl leading-relaxed">
              Your employer's stream keeps paying the same address. Sell the
              right to its future payouts without sharing a private key.
            </p>
            <p className="text-sm text-muted-foreground">
              A copied key cannot be taken back. Quitclaim gives the buyer a
              verifiable handover: the seller's outstanding signatures must be
              used up before the title moves.
            </p>
            <Link to="/mint" className="text-sm text-primary">
              Set up your receiving address →
            </Link>
          </div>
          <ol className="border-t">
            {[
              [
                "01",
                "One address. One title.",
                "A non-transferable Sablier stream pays a Base address. Its NFT on NEAR decides who may ask MPC to sign a withdrawal.",
              ],
              [
                "02",
                "Use up the seller's signatures.",
                "Before a sale, signing stops. A burn consumes the outstanding nonce on Base, making saved withdrawals unusable.",
              ],
              [
                "03",
                "Prove it, then hand it over.",
                "MPC attests that the nonce was consumed. Only then can the buyer receive the title and control the same address.",
              ],
            ].map(([number, title, description]) => (
              <li
                key={number}
                className="grid grid-cols-[3rem_1fr] gap-4 border-b py-6 sm:grid-cols-[3rem_1fr_1fr]"
              >
                <span className="font-mono text-xs text-primary">{number}</span>
                <h3 className="text-xl font-medium">{title}</h3>
                <p className="col-start-2 text-sm text-muted-foreground sm:col-start-auto">
                  {description}
                </p>
              </li>
            ))}
          </ol>
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
          final at the contract's selected finality. Cash-out also trusts
          Tidepool's custodial deposit relayer until it delivers test wNEAR or
          refunds the lot.
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
