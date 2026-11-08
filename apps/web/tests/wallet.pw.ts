import { expect, test } from "@playwright/test";

test("connect opens the library wallet picker", async ({ page }) => {
  await page.goto("http://localhost:3001/mint");
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .first()
    .click();
  await expect(page.getByText("Select wallet", { exact: true })).toBeVisible();
  await expect(page.getByText("Meteor Wallet", { exact: true })).toBeVisible();
});
