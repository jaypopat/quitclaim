import { baseTxUrl } from "@quitclaim/shared/base.ts";
import { nearTxUrl } from "@quitclaim/shared/near.ts";
import { formatUnits } from "viem";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { LotField } from "@/components/lot-field.tsx";
import {
  usePrefersReducedMotion,
  useDocumentVisible,
} from "@/lib/dither/motion";
import { fillStyle } from "@/lib/dither";
import { evidence, retainedWithdrawal } from "@/lib/heist-evidence.ts";
import { cn } from "@/lib/utils";

const { nonce, amount } = retainedWithdrawal;
const usdc = `${Number(formatUnits(amount, 6))} USDC`;
const alice = evidence.seller.near;
const bob = evidence.buyer.near;

type Slot = "used" | "signed" | "burned" | "open";
type Link = { label: string; href: string };
type Step = {
  title: string;
  holder: string;
  slot: Slot;
  saved: string;
  link?: Link;
};

/** The published run, step by step. Every name, nonce and hash comes from `reports/heist.json`. */
const STEPS: Step[] = [
  {
    title: "A Sablier stream pays one address. Alice holds its title.",
    holder: alice,
    slot: "open",
    saved: "Not signed yet",
  },
  {
    title: `Alice signs a ${usdc} withdrawal and keeps it.`,
    holder: alice,
    slot: "signed",
    saved: `Valid at nonce ${nonce}`,
  },
  {
    title: `Before the sale, the contract burns nonce ${nonce} on Base. NEAR checks it landed.`,
    holder: alice,
    slot: "burned",
    saved: `Dead: nonce ${nonce} is used`,
    link: {
      label: "NEAR's check of the burn",
      href: nearTxUrl(evidence.proof.hash),
    },
  },
  {
    title: "Bob buys the NFT. Same address, same stream.",
    holder: bob,
    slot: "burned",
    saved: `Dead: nonce ${nonce} is used`,
    link: { label: "The sale on NEAR", href: nearTxUrl(evidence.sale.hash) },
  },
  {
    title: "Alice sends her saved withdrawal. Base rejects it.",
    holder: bob,
    slot: "burned",
    saved: "Rejected by Base",
    link: { label: "The burn on Base", href: baseTxUrl(evidence.consumingTx) },
  },
];

const FILL: Record<Slot, { label: string; style: CSSProperties }> = {
  used: {
    label: "used",
    style: fillStyle("gradient", {
      color: "var(--muted-foreground)",
      length: 32,
    }),
  },
  signed: {
    label: "signed, kept",
    style: fillStyle("dotted", { color: "ink" }),
  },
  burned: { label: "burned", style: fillStyle("hatched", { color: "ink" }) },
  open: { label: "open", style: {} },
};

const TICK_MS = 3600;

/** Advance through the steps while the story is on screen, until the reader picks one. */
function useAutoplay(count: number) {
  const reduced = usePrefersReducedMotion();
  const visible = useDocumentVisible();
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e!.isIntersecting), {
      threshold: 0.4,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!playing || !inView || reduced || !visible) return;
    const timer = setInterval(() => setStep((s) => (s + 1) % count), TICK_MS);
    return () => clearInterval(timer);
  }, [playing, inView, count, reduced, visible]);
  const pick = (i: number) => {
    setPlaying(false);
    setStep(i);
  };
  return {
    ref,
    step,
    pick,
    playing,
    reduced,
    toggle: () => setPlaying((value) => !value),
  };
}

function NonceCell({
  n,
  slot,
  focus,
}: {
  n: number;
  slot: Slot;
  focus: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div
        className={cn(
          "relative h-28 border sm:h-36",
          focus ? "border-primary" : "border-border",
        )}
      >
        <div className="absolute inset-1.5" style={FILL[slot].style} />
      </div>
      <span className="flex flex-col font-mono text-xs sm:flex-row sm:justify-between sm:gap-2">
        <span className={focus ? "text-primary" : "text-muted-foreground"}>
          nonce {n}
        </span>
        <span className="truncate text-muted-foreground">
          {FILL[slot].label}
        </span>
      </span>
    </div>
  );
}

export function HandoverStory() {
  const { ref, step, pick, playing, reduced, toggle } = useAutoplay(
    STEPS.length,
  );
  const current = STEPS[step]!;
  const rejected = step === STEPS.length - 1;
  return (
    <div
      ref={ref}
      className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]"
    >
      <div className="flex flex-col gap-7">
        <div className="flex flex-col gap-3">
          <h2 className="text-[clamp(30px,3.6vw,48px)] leading-[1.04] font-medium tracking-[-0.035em] text-balance">
            Watch a sale. Then try to rob it.
          </h2>
          <p className="max-w-[30em] text-muted-foreground">
            Alice signs a withdrawal and keeps it. Then she sells to Bob. This
            is the real run on testnet, and what happens when she sends it.
          </p>
        </div>
        <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
          <span>Choose a step to pause the story.</span>
          <button
            type="button"
            onClick={toggle}
            disabled={reduced}
            className="shrink-0 underline underline-offset-4 disabled:no-underline"
          >
            {reduced
              ? "Reduced motion"
              : playing
                ? "Pause story"
                : "Play story"}
          </button>
        </div>
        <ol className="flex flex-col">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <button
                type="button"
                onClick={() => pick(i)}
                aria-current={i === step ? "step" : undefined}
                className="grid w-full grid-cols-[2.4em_minmax(0,1fr)] items-baseline gap-3 border-t py-3.5 text-left"
              >
                <span
                  className={cn(
                    "font-mono text-xs",
                    i === step ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {i + 1}
                </span>
                <span
                  className={cn(
                    "text-lg text-pretty transition-colors",
                    i === step
                      ? "font-medium text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {s.title}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-5 border bg-card p-5 sm:p-6">
          <div className="flex items-center gap-4">
            <LotField
              id={evidence.lot.id}
              offer={step === 3 ? "sale" : "none"}
              size={2}
              className="size-16 shrink-0 border"
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-mono text-xs text-primary">
                NFT TITLE · QUITCLAIM #{evidence.lot.id}
              </span>
              <span
                key={current.holder}
                className="truncate text-xl font-medium animate-in duration-500 fade-in motion-reduce:animate-none"
              >
                {current.holder}
              </span>
              <span className="truncate font-mono text-xs text-muted-foreground">
                controls {evidence.lot.address.slice(0, 10)}… on Base
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <NonceCell n={nonce - 1} slot="used" focus={false} />
            <NonceCell n={nonce} slot={current.slot} focus />
            <NonceCell n={nonce + 1} slot="open" focus={false} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5 border p-4">
            <span className="font-mono text-xs text-muted-foreground">
              WHO CONTROLS THE ADDRESS
            </span>
            <span className="truncate text-lg">
              {current.holder === alice ? "Alice" : "Bob"}
            </span>
            <span className="text-xs text-muted-foreground">
              The stream keeps paying the same address.
            </span>
          </div>
          <div
            className={cn(
              "flex min-w-0 flex-col gap-1.5 border p-4",
              rejected ? "border-primary" : "border-border",
            )}
          >
            <span className="font-mono text-xs text-primary">
              ALICE'S SAVED WITHDRAWAL
            </span>
            <span
              key={current.saved}
              className="text-lg animate-in duration-500 fade-in motion-reduce:animate-none"
            >
              {current.saved}
            </span>
            <span className="text-xs text-muted-foreground">
              {usdc} at nonce {nonce}. Its bytes never change.
            </span>
          </div>
        </div>
        <div className="min-h-5 text-sm">
          {current.link && (
            <a
              href={current.link.href}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground hover:decoration-primary"
            >
              {current.link.label} ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
