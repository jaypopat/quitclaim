import { handover } from "./handover.ts";
import { minting } from "./minting.ts";
import { recovery } from "./recovery.ts";

export const scenarios = { minting, handover, recovery } as const;
