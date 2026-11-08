import { expect, test } from "bun:test";
import { holdsTestUsdc } from "./lot-views.ts";
import { lot, TOKEN } from "./testing.ts";

test("a lot in Tidepool's test USDC is shown whatever the address case", () => {
  expect(holdsTestUsdc(lot({ token: TOKEN.toLowerCase() }))).toBe(true);
  expect(
    holdsTestUsdc(lot({ token: TOKEN.toUpperCase().replace("0X", "0x") })),
  ).toBe(true);
});

test("a lot minted against the older test token is not", () => {
  expect(
    holdsTestUsdc(lot({ token: "0x2a639c03a65c73d35e8091714a49182f67b7dbfc" })),
  ).toBe(false);
});
