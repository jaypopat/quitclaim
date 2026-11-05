import { afterAll, expect, test } from "bun:test";
import { nearView } from "./near.ts";

const answer = Buffer.from(JSON.stringify("3.18.0"));
const server = Bun.serve({
  port: 0,
  fetch: () =>
    Response.json({ jsonrpc: "2.0", id: 1, result: { result: [...answer], logs: [], block_height: 1, block_hash: "11111111111111111111111111111111" } }),
});
const broken = Bun.serve({ port: 0, fetch: () => Response.json({ jsonrpc: "2.0", id: 1, error: { message: "bad gateway" } }, { status: 502 }) });
afterAll(() => {
  server.stop(true);
  broken.stop(true);
});

test("NEAR views fail over past a dead endpoint and a 5xx", async () => {
  const urls = ["http://127.0.0.1:9", broken.url.href, server.url.href];
  expect(await nearView<string>("v1.signer-prod.testnet", "version", {}, urls)).toBe("3.18.0");
}, 30_000);

test("NEAR views reject when every endpoint is down", async () => {
  await expect(nearView("v1.signer-prod.testnet", "version", {}, ["http://127.0.0.1:9", broken.url.href])).rejects.toThrow();
}, 30_000);
