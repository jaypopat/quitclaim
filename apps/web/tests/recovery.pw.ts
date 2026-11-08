import { expect, test } from "@playwright/test";

const contract = process.env.LOT_CONTRACT;
if (!contract) throw new Error("LOT_CONTRACT is required");
const storeKey = `quitclaim:recovery:${contract}`;
const cashKey = `quitclaim:cash-out:${contract}:3`;
const mintKey = `quitclaim:mint:${contract}:alice.testnet`;
const payment = {
  depositAddress: "0x0000000000000000000000000000000000000001",
  recipient: "alice.testnet",
  amount: "500000",
  payout: "1000000000000000000000",
  deadline: "2026-11-08T15:00:00Z",
  approvalStarted: true,
  fromBlock: "1",
};

test("a new browser starts with empty recovery records", async ({ page }) => {
  await page.goto("http://localhost:3001/mint");
  const state = await page.evaluate(async () => {
    const path = "/src/lib/recovery.ts";
    return (await import(path)).readRecovery();
  });
  expect(state).toEqual({ cashOuts: {}, mints: {} });
});

test("old per-record data survives the single-store migration and reload", async ({
  page,
}) => {
  await page.addInitScript(
    ({ cashKey, mintKey, payment }) => {
      if (location.origin === "null") return;
      localStorage.setItem(cashKey, JSON.stringify(payment));
      localStorage.setItem(
        mintKey,
        JSON.stringify({ state: { value: { step: "address" } }, version: 1 }),
      );
    },
    { cashKey, mintKey, payment },
  );
  await page.goto("http://localhost:3001/mint");
  const result = await page.evaluate(async (key) => {
    const path = "/src/lib/recovery.ts";
    const cashPath = "/src/lib/cash-out.ts";
    const { readRecovery } = await import(path);
    const { readCashOut, saveCashOut } = await import(cashPath);
    const before = readRecovery();
    const record = readCashOut(3);
    saveCashOut(3, { ...record, amount: "600000" });
    return { before, saved: JSON.parse(localStorage.getItem(key)!) };
  }, storeKey);
  expect(result.before).toEqual({
    cashOuts: { 3: payment },
    mints: { "alice.testnet": { step: "address" } },
  });
  expect(result.saved.state.cashOuts[3].amount).toBe("600000");
  await page.reload();
  const restored = await page.evaluate(async () => {
    const path = "/src/lib/recovery.ts";
    return (await import(path)).readRecovery();
  });
  expect(restored.cashOuts[3].amount).toBe("600000");
  expect(restored.mints["alice.testnet"]).toEqual({ step: "address" });
});

for (const [label, raw] of [
  ["corrupt", "{broken"],
  [
    "future-version",
    JSON.stringify({ state: { cashOuts: {}, mints: {} }, version: 2 }),
  ],
]) {
  test(`${label} recovery data blocks reads without overwriting it`, async ({
    page,
  }) => {
    await page.addInitScript(
      ({ key, raw }) => {
        if (location.origin !== "null") localStorage.setItem(key, raw);
      },
      { key: storeKey, raw },
    );
    await page.goto("http://localhost:3001/mint");
    const result = await page.evaluate(
      async ({ key, raw }) => {
        const path = "/src/lib/recovery.ts";
        const { readRecovery } = await import(path);
        let blocked = false;
        try {
          readRecovery();
        } catch {
          blocked = true;
        }
        return { blocked, preserved: localStorage.getItem(key) === raw };
      },
      { key: storeKey, raw },
    );
    expect(result).toEqual({ blocked: true, preserved: true });
  });
}
