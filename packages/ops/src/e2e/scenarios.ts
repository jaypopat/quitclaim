import { handover } from "./handover.ts";
import { lease } from "./lease.ts";
import { minting } from "./minting.ts";
import { recovery } from "./recovery.ts";

export const scenarios = { minting, handover, recovery, lease } as const;
