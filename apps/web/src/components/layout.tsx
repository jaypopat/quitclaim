import { Link, Outlet } from "@tanstack/react-router";
import { ThemeToggle } from "@/components/theme-toggle.tsx";
import { WalletButton } from "@/components/wallet-button.tsx";

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
    </div>
  );
}
