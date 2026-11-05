import { afterAll, expect, test } from "bun:test";
import { nearView } from "./rpc.ts";

const answer = Buffer.from(JSON.stringify("3.18.0"));
const server = Bun.serve({
  port: 0,
  fetch: async (req) => {
    const { method } = (await req.json()) as { method: string };
    return Response.json({ jsonrpc: "2.0", id: 1, result: method === "query" ? { result: [...answer] } : null });
  },
});
const broken = Bun.serve({ port: 0, fetch: () => Response.json({ jsonrpc: "2.0", id: 1, error: { message: "bad gateway" } }, { status: 502 }) });
afterAll(() => {
  server.stop(true);
  broken.stop(true);
});

test("NEAR RPC fails over past a dead endpoint and a 5xx", async () => {
  const urls = ["http://127.0.0.1:9", broken.url.href, server.url.href];
  expect(await nearView<string>("v1.signer-prod.testnet", "version", {}, "final", urls)).toBe("3.18.0");
});
