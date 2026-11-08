import { nearToYocto } from "near-api-js";
import { isAddress, parseUnits } from "viem";
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
