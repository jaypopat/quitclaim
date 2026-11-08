import type { ReactNode } from "react";
import { WalletProvider } from "@/lib/wallet.tsx";
import {
  ClientOnly,
  createRootRoute,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { Layout } from "@/components/layout.tsx";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import css from "@/index.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Quitclaim" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap",
      },
      { rel: "stylesheet", href: css },
    ],
  }),
  shellComponent: Shell,
  component: Root,
});

/** wallet-selector reads browser storage as it renders, so the app renders only in the browser. */
function Root() {
  return (
    <ClientOnly>
      <WalletProvider>
        <Layout />
      </WalletProvider>
    </ClientOnly>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    // next-themes sets the theme class before hydration.
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
