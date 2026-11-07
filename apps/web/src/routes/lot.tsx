import { useParams } from "@tanstack/react-router";
import { Page } from "@/components/page.tsx";

export function LotPage() {
  const { id } = useParams({ from: "/lot/$id" });
  return <Page title={`Quitclaim #${id}`}>{null}</Page>;
}
