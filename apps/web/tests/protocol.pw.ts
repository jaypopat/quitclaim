import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { account } from "../../../packages/sdk/src/near.ts";
import { env } from "../../../packages/sdk/src/env.ts";
import { fund, wallet } from "../../../packages/sdk/src/base.ts";
import { config } from "../../../packages/shared/src/config.ts";
import { getLot, mintedLot } from "../../../packages/shared/src/lot-views.ts";
import { baseClient } from "../../../packages/shared/src/base.ts";
import { getAddress, erc20Abi } from "viem";
import type { ContractCall } from "../../../packages/shared/src/calls.ts";

// Real keys live only in this Bun process. The test-mode page receives outcomes, never keys.
async function actor(browser: Browser, signerId: string) {
  const context = await browser.newContext();
  await context.exposeBinding(
    "quitclaimTestSign",
    async (_source, call: ContractCall & { contractId: string }) => {
      if (call.contractId !== env.lotContract())
        throw new Error("Unexpected contract");
      return (await account(signerId)).callFunctionRaw({
        contractId: call.contractId,
        methodName: call.method,
        args: call.args,
        deposit: BigInt(call.deposit),
        gas: BigInt(call.gas),
        waitUntil: "FINAL",
      });
    },
  );
  await context.addInitScript((id) => {
    if (location.origin !== "null")
      sessionStorage.setItem("quitclaim-test-account", id);
  }, signerId);
  return { context, page: await context.newPage() };
}
async function click(page: Page, label: string) {
  console.log("Click", label);
  await page.getByRole("button", { name: label, exact: true }).click();
}
async function form(page: Page, label: string, fields: Record<string, string>) {
  await click(page, label);
  const dialog = page.getByRole("dialog");
  for (const [name, value] of Object.entries(fields))
    await dialog.getByLabel(name, { exact: true }).fill(value);
  await dialog.getByRole("button", { name: label, exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: label, exact: true }),
  ).toBeEnabled({ timeout: 120_000 });
  await page.keyboard.press("Escape");
}
const contract = env.lotContract();
async function lotState(id: number, state: string) {
  await expect
    .poll(async () => (await getLot(contract, id))?.state, { timeout: 120_000 })
    .toBe(state);
}

test("real mint, reload, sale, lease, withdrawal and NEAR cash-out", async ({
  browser,
}) => {
  test.setTimeout(900_000);
  const alice = await actor(browser, env.alice());
  const bob = await actor(browser, env.bob());
  const carol = await actor(browser, env.carol());
  const name = `browser-${Date.now()}`;
  const page = alice.page;
  page.on("pageerror", (error) => console.error("PAGE", error.message));
  await page.goto("http://localhost:3001/mint");
  await page.getByLabel("Name this position").fill(name);
  await click(page, "Generate receiving address →");
  await click(page, "Use an example employer-funded stream");
  await expect(
    page.getByRole("heading", { name: "Your stream is ready." }),
  ).toBeVisible({ timeout: 120_000 });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your stream is ready." }),
  ).toBeVisible({ timeout: 60_000 });
  await click(page, "Verify stream & mint title");
  await expect(
    page.getByRole("heading", { name: `${name} is yours.` }),
  ).toBeVisible({ timeout: 120_000 });
  const id = await mintedLot(contract, env.alice(), `${env.alice()}/${name}`);
  if (id === null) throw new Error("Mint did not create title");
  const lot = await getLot(contract, id);
  if (!lot?.address) throw new Error("No lot address");
  const address = getAddress(lot.address);
  await fund(address, 500_000_000_000_000n);
  const funding = await wallet().writeContract({
    address: config.evm.token,
    abi: erc20Abi,
    functionName: "transfer",
    args: [address, 1_000_000n],
  });
  await baseClient.waitForTransactionReceipt({ hash: funding });
  await page.goto(`http://localhost:3001/lot/${id}`);
  await click(page, "Seal");
  await lotState(id, "Clean");
  await page.reload();
  await form(page, "List for sale", { "Price in NEAR": "0.01" });
  await bob.page.goto(`http://localhost:3001/lot/${id}`);
  await click(bob.page, "Buy · 0.01 NEAR");
  await expect
    .poll(async () => (await getLot(contract, id))?.owner, {
      intervals: [2000, 5000, 10000],
    })
    .toBe(env.bob());
  await page.goto("about:blank");
  await bob.page.reload();
  await click(bob.page, "Seal");
  await lotState(id, "Clean");
  await bob.page.reload();
  const ends = new Date(Date.now() + 600_000).toISOString().slice(0, 16);
  await form(bob.page, "Offer a lease", {
    "Price in NEAR": "0.001",
    Ends: ends,
  });
  await bob.page.goto("about:blank");
  await carol.page.goto(`http://localhost:3001/lot/${id}`);
  await click(carol.page, "Take the lease · 0.001 NEAR");
  await expect
    .poll(async () => (await getLot(contract, id))?.lease?.holder, {
      intervals: [2000, 5000, 10000],
    })
    .toBe(env.carol());
  await carol.page.reload();
  await expect(
    carol.page.getByRole("heading", { name: "Cash out to NEAR" }),
  ).toHaveCount(0);
  await form(carol.page, "Send to a Base address", {
    "To (Base address)": "0x0000000000000000000000000000000000000001",
    "Amount in USDC": "0.000001",
  });
  await expect
    .poll(async () => (await getLot(contract, id))?.next_nonce, {
      timeout: 180_000,
    })
    .toBe(1);
  await carol.page.reload();
  await click(carol.page, "Seal");
  await lotState(id, "Clean");
  await carol.page.reload();
  await click(carol.page, "Surrender the lease");
  await expect.poll(async () => (await getLot(contract, id))?.lease).toBeNull();
  await carol.page.goto("about:blank");
  await bob.page.goto(`http://localhost:3001/lot/${id}`);
  if ((await getLot(contract, id))?.state === "Clean") {
    await click(bob.page, "Unseal");
    await lotState(id, "Active");
    await bob.page.reload();
  }
  await bob.page.getByLabel(`Amount in test USDC`, { exact: true }).fill("0.5");
  await click(bob.page, "Get cash-out quote");
  await expect(
    bob.page.getByRole("button", { name: "Approve cash-out in wallet" }),
  ).toBeVisible({ timeout: 60_000 });
  await click(bob.page, "Approve cash-out in wallet");
  await expect
    .poll(async () => (await getLot(contract, id))?.next_nonce, {
      timeout: 180_000,
    })
    .toBe(2);
  await bob.page.reload();
  await expect(
    bob.page.getByRole("status").filter({ hasText: "SUCCESS" }),
  ).toBeVisible({ timeout: 600_000 });
  await bob.page.screenshot({
    path: "/tmp/quitclaim-cash-out.png",
    fullPage: true,
  });
  await Promise.all([
    alice.context.close(),
    bob.context.close(),
    carol.context.close(),
  ]);
});
