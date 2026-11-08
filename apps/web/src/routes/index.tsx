import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { config } from "@quitclaim/shared/config.ts";
import type { ReactNode } from "react";
import { HandoverStory } from "@/components/landing/handover-story.tsx";
import { HeistReplay } from "@/components/landing/heist-replay.tsx";
import { OfferKinds } from "@/components/landing/offer-kinds.tsx";
import { HeroLot } from "@/components/landing/hero-lot.tsx";
import { LotCard } from "@/components/lot-card.tsx";
import { Button } from "@/components/ui/button";
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
    <section className="flex flex-col gap-10 border-t px-[clamp(20px,4vw,64px)] py-[clamp(56px,9vh,112px)]">
      <H2>{title}</H2>
      {children}
    </section>
  );
}

function H2({ children }: { children: ReactNode }) {
  return (
    <h2 className="max-w-[14em] text-[clamp(30px,3.6vw,48px)] leading-[1.04] font-medium tracking-[-0.035em] text-balance">
      {children}
    </h2>
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
    <div
      className={`flex h-full flex-col gap-3 border bg-card p-6 transition-colors ${accent ? "border-primary" : ""} ${href ? "hover:border-primary" : ""}`}
    >
      <span className="font-mono text-xs text-primary">
        {eyebrow}
        {href && " ↗"}
      </span>
      <h3 className="text-xl leading-snug font-medium tracking-[-0.01em]">
        {title}
      </h3>
      <p className="text-sm text-pretty text-muted-foreground">{children}</p>
    </div>
  );
  return href ? (
    <a href={href} target="_blank" rel="noreferrer">
      {body}
    </a>
  ) : (
    body
  );
}

function Landing() {
  const { data: ids } = useQuery(lotIdsQuery);
  const { data: frozen } = useQuery(frozenQuery);
  const heroId = ids?.at(0);
  return (
    <main>
      <section className="grid min-h-[calc(100dvh-4rem)] items-center gap-[clamp(32px,5vw,72px)] px-[clamp(20px,4vw,64px)] pt-[clamp(24px,4vh,48px)] pb-[clamp(48px,8vh,96px)] lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-7">
          <span className="font-mono text-xs text-primary">
            BUILT ON NEAR CHAIN SIGNATURES
          </span>
          <h1 className="text-[clamp(44px,6.4vw,88px)] leading-[0.98] font-medium tracking-[-0.045em] text-balance">
            Sell a wallet. The seller keeps nothing.
          </h1>
          <p className="max-w-[27em] text-[clamp(17px,1.4vw,19px)] text-pretty text-muted-foreground">
            Sell your locked vesting tokens, even from a non-transferable
            stream. The stream pays one address. An NFT on NEAR is the title to
            it. Before the title moves, everything the seller signed is
            cancelled on Base.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" className="h-12 px-6 text-[15px]">
              <Link to="/market">Browse positions</Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-12 px-5 text-[15px]"
            >
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
        className="flex scroll-mt-16 flex-col gap-12 border-t px-[clamp(20px,4vw,64px)] py-[clamp(56px,9vh,112px)]"
      >
        <HandoverStory />
        <div className="border border-primary p-[clamp(20px,3vw,36px)]">
          <HeistReplay />
        </div>
      </section>

      <Section title="Sell it all, or lease the unlocks.">
        <OfferKinds />
      </Section>

      <section className="flex flex-col gap-10 border-t px-[clamp(20px,4vw,64px)] py-[clamp(56px,9vh,112px)]">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <H2>On the market</H2>
          <Link
            to="/market"
            className="text-[15px] underline decoration-border underline-offset-[5px] hover:decoration-primary"
          >
            See all positions
          </Link>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-4">
          {ids
            ? ids
                .slice(-4)
                .reverse()
                .map((id) => <LotCard key={id} id={id} />)
            : Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-96" />
              ))}
        </div>
      </section>

      <Section title="What's real.">
        <p className="-mt-6 max-w-2xl text-muted-foreground">
          Everything here runs on NEAR testnet and Base Sepolia today. The NFT
          isn't a picture. It's a working title to a wallet.
        </p>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-4">
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
        <p className="border p-5 text-sm leading-relaxed">
          <span className="mr-3 font-mono text-xs text-primary">
            WHAT YOU'RE TRUSTING
          </span>
          NEAR's MPC network signs and attests honestly. The lot contract is
          {frozen ? " frozen" : " frozen at the end"}. Base transactions are
          final at the contract's selected finality. Cash-out also trusts
          Tidepool's custodial deposit relayer until it delivers test wNEAR or
          refunds the lot.
        </p>
      </Section>

      <section className="flex flex-wrap items-end justify-between gap-8 border-t px-[clamp(20px,4vw,64px)] py-[clamp(56px,9vh,112px)]">
        <h2 className="max-w-[11em] text-[clamp(34px,4.6vw,64px)] leading-none font-medium tracking-[-0.04em] text-balance">
          Buy future payouts. Keep them.
        </h2>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg" className="h-12 px-6 text-[15px]">
            <Link to="/market">Browse positions</Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="h-12 px-5 text-[15px]"
          >
            <Link to="/mint">Sell a position</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
