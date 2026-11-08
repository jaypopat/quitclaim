import { expect, test } from "bun:test";
import { evmAddress, futureDate, nearAmount, tokenAmount } from "./inputs.ts";

test("a NEAR price becomes exact yoctoNEAR", () => {
  expect(nearAmount.parse("1.5")).toBe(1_500_000_000_000_000_000_000_000n);
  expect(nearAmount.parse(" 0.000000000000000000000001 ")).toBe(1n);
});

test("a NEAR price must be a positive decimal", () => {
  for (const bad of [
    "",
    "0",
    "abc",
    "-1",
    "1e3",
    "1.0000000000000000000000001",
  ])
    expect(nearAmount.safeParse(bad).success).toBe(false);
});

test("a token amount is parsed in the token's decimals and capped at what the lot holds", () => {
  const usdc = tokenAmount(6, 5_000_000n);
  expect(usdc.parse("4.25")).toBe(4_250_000n);
  expect(usdc.parse("5")).toBe(5_000_000n);
  expect(usdc.safeParse("5.000001").success).toBe(false);
  expect(usdc.safeParse("0.0000001").success).toBe(false);
});

test("a withdrawal goes only to a well-formed Base address", () => {
  expect(
    evmAddress.safeParse("0x38d81431B9f76d9699AF7517040D5221D9dEA252").success,
  ).toBe(true);
  expect(evmAddress.safeParse("0x38d8").success).toBe(false);
});

test("a lease must end in the future", () => {
  expect(futureDate.safeParse("2000-01-01T00:00").success).toBe(false);
  expect(futureDate.parse("2999-01-01T00:00")).toBe(
    new Date("2999-01-01T00:00").getTime(),
  );
});
