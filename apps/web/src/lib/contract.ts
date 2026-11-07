import { z } from "zod";

/** Inlined at bundle time from `.env` (see bunfig.toml `[serve.static] env`). */
export const LOT_CONTRACT = z
  .string()
  .min(2, "BUN_PUBLIC_LOT_CONTRACT is not set (see .env.example)")
  .parse(process.env.BUN_PUBLIC_LOT_CONTRACT);
