import { Link, Outlet } from "@tanstack/react-router";
import { config } from "@quitclaim/shared/config.ts";
import { ThemeToggle } from "@/components/theme-toggle.tsx";
import { WalletButton } from "@/components/wallet-button.tsx";
import { GITHUB, LOT_CONTRACT } from "@/lib/contract.ts";

const nav = [
  { to: "/market", label: "Market" },
  { to: "/portfolio", label: "Portfolio" },
] as const;

export function Layout() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
        <div className="flex min-h-16 flex-wrap items-center gap-x-6 gap-y-2 px-[clamp(20px,4vw,64px)] py-3">
          <Link to="/" className="text-base font-semibold tracking-tight">
            Quitclaim
          </Link>
          <nav className="order-3 flex basis-full gap-5 text-sm sm:order-none sm:basis-auto">
            {nav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="py-1 text-muted-foreground transition-colors hover:text-foreground"
                activeProps={{
                  className: "text-foreground border-b border-primary",
                }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
              testnet
            </span>
            <ThemeToggle />
            <WalletButton />
          </div>
        </div>
      </header>
      <Outlet />
      <footer className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3 border-t px-[clamp(20px,4vw,64px)] py-8 text-sm text-muted-foreground">
        <span>
          Built for the NEAR Hackathon, NFTs That Do Something track. Testnet
          only, test USDC with no value.
        </span>
        <nav className="flex flex-wrap gap-x-6 gap-y-2">
          <a
            href={GITHUB}
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground"
          >
            GitHub ↗
          </a>
          <a
            href={`${config.near.explorer}/address/${LOT_CONTRACT}`}
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground"
          >
            Contract on NEAR ↗
          </a>
          <Link to="/" hash="heist" className="hover:text-foreground">
            Try the heist
          </Link>
        </nav>
      </footer>
    </div>
  );
}
