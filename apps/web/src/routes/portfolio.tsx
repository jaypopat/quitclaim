import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/page.tsx";

export const Route = createFileRoute("/portfolio")({ component: Portfolio });

function Portfolio() {
  return <Page title="Portfolio">{null}</Page>;
}
