import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/page.tsx";

export const Route = createFileRoute("/mint")({ component: Mint });

function Mint() {
  return <Page title="Mint">{null}</Page>;
}
