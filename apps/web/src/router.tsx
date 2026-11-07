import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { z } from "zod";
import { Layout } from "@/components/layout.tsx";
import { Landing } from "@/routes/landing.tsx";
import { Market } from "@/routes/market.tsx";
import { LotPage } from "@/routes/lot.tsx";
import { Portfolio } from "@/routes/portfolio.tsx";
import { Mint } from "@/routes/mint.tsx";

const root = createRootRoute({ component: Layout });

const lotParams = z.object({ id: z.coerce.number().int().nonnegative() });

const routeTree = root.addChildren([
  createRoute({ getParentRoute: () => root, path: "/", component: Landing }),
  createRoute({
    getParentRoute: () => root,
    path: "/market",
    component: Market,
  }),
  createRoute({
    getParentRoute: () => root,
    path: "/lot/$id",
    params: {
      parse: (raw) => lotParams.parse(raw),
      stringify: ({ id }) => ({ id: String(id) }),
    },
    component: LotPage,
  }),
  createRoute({
    getParentRoute: () => root,
    path: "/portfolio",
    component: Portfolio,
  }),
  createRoute({ getParentRoute: () => root, path: "/mint", component: Mint }),
]);

export const router = createRouter({ routeTree, scrollRestoration: true });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
