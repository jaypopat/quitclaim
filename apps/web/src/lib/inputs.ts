import { nearToYocto } from "near-api-js";
import { isAddress, isHash, parseUnits, type Hex } from "viem";
import { z } from "zod";

const decimal = (places: number) =>
  z
    .string()
    .trim()
    .regex(new RegExp(`^\\d+(\\.\\d{1,${places}})?$`), "Enter an amount");

export const nearAmount = decimal(24)
  .transform((v) => nearToYocto(v as `${number}`))
  .refine((v) => v > 0n, "Must be more than 0");

export const tokenAmount = (decimals: number, max: bigint) =>
  decimal(decimals)
    .transform((v) => parseUnits(v, decimals))
    .refine((v) => v > 0n, "Must be more than 0")
    .refine((v) => v <= max, "More than the lot holds");

export const evmAddress = z
  .string()
  .trim()
  .refine((v) => isAddress(v), "Not a Base address");

export const futureDate = z
  .string()
  .min(1, "Pick a date")
  .transform((v) => new Date(v).getTime())
  .refine((ms) => ms > Date.now(), "Must be in the future");

/** NEAR's account id rule: 2 to 64 chars, dot-separated parts of lowercase letters and digits joined by - or _. */
export const nearAccount = z
  .string()
  .regex(
    /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/,
    "Not a NEAR account",
  );

/** What `mint_proven` accepts as a lot name. */
export const lotName = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9._-]{1,64}$/,
    "Use 1 to 64 letters, numbers, dots, dashes or underscores",
  );

/** A resale royalty in percent, 0 to 10 with up to two decimals, as basis points. */
export const royaltyBps = decimal(2)
  .transform((v) => Math.round(Number(v) * 100))
  .refine((bps) => bps <= 1_000, "At most 10%");

export const txHash = z
  .string()
  .trim()
  .refine(isHash, "Enter the full Base transaction hash, 0x and 64 hex digits")
  .transform((v) => v as Hex);
