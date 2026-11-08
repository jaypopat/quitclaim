import { expect, test } from "@playwright/test";

// Exercise real localStorage and Zustand's persistence in Chromium, without sending a transaction.
test("legacy recovery records survive the Zustand upgrade and a reload", async ({
  page,
}) => {
  await page.goto("http://localhost:3001/mint");
  const result = await page.evaluate(async () => {
    const modulePath = "/src/lib/persisted-record.ts";
    const inputsPath = "/src/lib/inputs.ts";
    const { persistedRecord } = await import(modulePath);
    const { lotName } = await import(inputsPath);
    const key = "quitclaim-test:legacy-record";
    localStorage.setItem(key, JSON.stringify("saved-operation"));
    const record = persistedRecord(key, lotName);
    const recovered = record.read();
    record.write("updated-operation");
    return { recovered, saved: JSON.parse(localStorage.getItem(key)!) };
  });
  expect(result.recovered).toBe("saved-operation");
  expect(result.saved).toEqual({
    state: { value: "updated-operation" },
    version: 1,
  });
  await page.reload();
  const restored = await page.evaluate(async () => {
    const modulePath = "/src/lib/persisted-record.ts";
    const inputsPath = "/src/lib/inputs.ts";
    const { persistedRecord } = await import(modulePath);
    const { lotName } = await import(inputsPath);
    return persistedRecord("quitclaim-test:legacy-record", lotName).read();
  });
  expect(restored).toBe("updated-operation");
});

test("invalid or future-version records block recovery and remain intact", async ({
  page,
}) => {
  await page.goto("http://localhost:3001/mint");
  const result = await page.evaluate(async () => {
    const modulePath = "/src/lib/persisted-record.ts";
    const inputsPath = "/src/lib/inputs.ts";
    const { persistedRecord } = await import(modulePath);
    const { lotName } = await import(inputsPath);
    return [
      "{broken",
      JSON.stringify({ state: { value: "saved-operation" }, version: 2 }),
    ].map((raw, i) => {
      const key = `quitclaim-test:invalid-record:${i}`;
      localStorage.setItem(key, raw);
      const record = persistedRecord(key, lotName);
      let blocked = false;
      try {
        record.read();
      } catch {
        blocked = true;
      }
      return { blocked, preserved: localStorage.getItem(key) === raw };
    });
  });
  expect(result).toEqual([
    { blocked: true, preserved: true },
    { blocked: true, preserved: true },
  ]);
});

test("the native storage event updates Zustand subscribers across tabs", async ({
  context,
  page,
}) => {
  await page.goto("http://localhost:3001/mint");
  await page
    .getByRole("heading", { name: "Set up receiving address" })
    .waitFor();
  await page.evaluate(async () => {
    const modulePath = "/src/lib/persisted-record.ts";
    const inputsPath = "/src/lib/inputs.ts";
    const { persistedRecord } = await import(modulePath);
    const { lotName } = await import(inputsPath);
    const resources = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name);
    const reactUrl = resources.find((url) => url.includes("/react.js?"));
    const domUrl = resources.find((url) =>
      url.includes("/react-dom_client.js?"),
    );
    if (!reactUrl || !domUrl)
      throw new Error("The app's React runtime has not loaded");
    const reactModule = await import(reactUrl);
    const React = reactModule.default ?? reactModule;
    const domModule = await import(domUrl);
    const { createRoot } = domModule.default ?? domModule;
    const record = persistedRecord("quitclaim-test:cross-tab", lotName);
    record.write("initial-record");
    const element = document.createElement("div");
    document.body.append(element);
    createRoot(element).render(
      React.createElement(() =>
        React.createElement(
          "output",
          { id: "recovery-test-value" },
          record.useValue() ?? "empty",
        ),
      ),
    );
  });
  await expect(page.locator("#recovery-test-value")).toHaveText(
    "initial-record",
  );
  const writer = await context.newPage();
  await writer.goto("http://localhost:3001/mint");
  await writer.evaluate(() =>
    localStorage.setItem(
      "quitclaim-test:cross-tab",
      JSON.stringify({ state: { value: "from-another-tab" }, version: 1 }),
    ),
  );
  await expect(page.locator("#recovery-test-value")).toHaveText(
    "from-another-tab",
  );
  await writer.evaluate(() =>
    localStorage.removeItem("quitclaim-test:cross-tab"),
  );
  await expect(page.locator("#recovery-test-value")).toHaveText("empty");
});
