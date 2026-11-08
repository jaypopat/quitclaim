import { z } from "zod";

/** From `.env` (see `.env.example`); Vite inlines `VITE_*` into the browser bundle. */
export const LOT_CONTRACT = z
  .string()
  .min(2, "VITE_LOT_CONTRACT is not set (see .env.example)")
  .parse(import.meta.env.VITE_LOT_CONTRACT);
