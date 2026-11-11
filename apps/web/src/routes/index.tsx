import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { config } from "@quitclaim/shared/config.ts";
import { position } from "@quitclaim/shared/derive.ts";
import type { ReactNode } from "react";
import { HandoverStory } from "@/components/landing/handover-story.tsx";
import { HeistReplay } from "@/components/landing/heist-replay.tsx";
import { OfferKinds } from "@/components/landing/offer-kinds.tsx";
import { HeroLot } from "@/components/landing/hero-lot.tsx";
import { TrustModel } from "@/components/landing/trust-model.tsx";
import { LotCard } from "@/components/lot-card.tsx";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { GITHUB, LOT_CONTRACT } from "@/lib/contract.ts";
import { frozenQuery, lotIdsQuery, lotQuery } from "@/lib/queries.ts";

export const Route = createFileRoute("/")({ component: Landing });

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
  const { data: frozen = false } = useQuery(frozenQuery);
  // Feature the lot with the most still to vest: the liveliest story, never a spent test lot.
  const heroId = useQueries({
    queries: (ids ?? []).map(lotQuery),
    combine: (results) => {
      if (results.some((r) => r.isPending)) return undefined;
      const nowSec = Date.now() / 1000;
      const views = results.flatMap((r) => (r.data ? [r.data] : []));
      return views.reduce<(typeof views)[number] | undefined>(
        (best, v) =>
          !best || position(v, nowSec).locked > position(best, nowSec).locked
            ? v
            : best,
        undefined,
      )?.id;
    },
  });
  return (
    <main>
      <section className="grid min-h-[calc(100dvh-4rem)] items-center gap-[clamp(32px,5vw,72px)] px-[clamp(20px,4vw,64px)] pt-[clamp(24px,4vh,48px)] pb-[clamp(48px,8vh,96px)] lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-7">
          <span className="font-mono text-xs text-primary">
            BUILT ON NEAR CHAIN SIGNATURES
          </span>
          <h1 className="text-[clamp(44px,6.4vw,88px)] leading-[0.98] font-medium tracking-[-0.045em] text-balance">
            An NFT that owns a wallet.
          </h1>
          <p className="max-w-[27em] text-[clamp(17px,1.4vw,19px)] text-pretty text-muted-foreground">
            Locked vesting tokens can't be sold, and handing over a private key
            doesn't work, because the seller keeps a copy. Quitclaim makes an
            NFT the title to the address your stream pays. Sell the NFT, and
            nothing the seller signed can touch the money again.
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
                Sell them now, lease out the next month of unlocks, or cash out
                what has vested to NEAR.
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

      <Section title="No private key. Four NEAR pieces instead.">
        <div className="grid gap-12 lg:grid-cols-[1fr_2fr]">
          <div className="flex flex-col gap-6">
            <p className="text-xl leading-relaxed">
              The address on Base has no private key to copy. NEAR's MPC network
              signs for it, and only when the lot contract asks.
            </p>
            <p className="text-sm text-muted-foreground">
              So the title can change hands, the stream keeps paying the same
              address, and the seller is left with nothing that still works.
            </p>
            <Link to="/mint" className="text-sm text-primary">
              Turn your stream into a title →
            </Link>
          </div>
          <ol className="border-t">
            {[
              [
                "NEP-171",
                "The NFT is the title.",
                "Whoever holds it controls the address. Sell it like any NFT, and the minter earns a royalty on each resale.",
              ],
              [
                "CHAIN SIGNATURES",
                "MPC signs for its holder only.",
                "Withdrawals from the address are signed by NEAR's MPC network, for the current holder and nobody else.",
              ],
              [
                "VERIFY_FOREIGN_TRANSACTION",
                "The seller's last signature is burned, and proven.",
                "Before a sale, the contract burns the seller's outstanding nonce on Base. MPC proves the burn landed. Only then does the title move.",
              ],
              [
                "NEAR INTENTS",
                "Cash out to NEAR in one step.",
                "The owner swaps the USDC in the address for wNEAR through 1Click on NEAR Intents, with no bridge to run. On testnet it uses Tidepool's sandbox and test tokens.",
              ],
            ].map(([primitive, title, description]) => (
              <li
                key={primitive}
                className="grid gap-2 border-b py-6 sm:grid-cols-[1fr_1fr] sm:gap-x-6"
              >
                <span className="font-mono text-xs break-all text-primary sm:col-span-2">
                  {primitive}
                </span>
                <h3 className="text-xl font-medium">{title}</h3>
                <p className="text-sm text-muted-foreground">{description}</p>
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
        <TrustModel frozen={frozen} />
      </Section>

      <section className="flex flex-col gap-10 border-t px-[clamp(20px,4vw,64px)] py-[clamp(56px,9vh,112px)]">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <H2>Latest titles</H2>
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
