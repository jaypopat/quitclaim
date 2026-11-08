import { yoctoToNear } from "near-api-js";
import { formatUnits } from "viem";

const twoPlaces = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const formatToken = (value: bigint, decimals: number) =>
  twoPlaces.format(Number(formatUnits(value, decimals)));

export const formatNear = (yocto: bigint) => {
  const value = yoctoToNear(yocto);
  return value.includes(".") ? value : `${value}.00`;
};

export const formatPercent = (fraction: number) =>
  new Intl.NumberFormat("en-US", { style: "percent" }).format(fraction);

export const monthYear = (ms: number) =>
  new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(
    ms,
  );

export const dayMonth = (ms: number) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
    ms,
  );

export const date = (ms: number) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(ms);

export const dateTime = (ms: number) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(ms);

export const shortAddress = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;
