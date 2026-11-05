import { handover } from "./handover.ts";
import { lease } from "./lease.ts";
import { minting } from "./minting.ts";
import type { ScenarioName } from "./names.ts";
import { recovery } from "./recovery.ts";
import type { Run } from "./report.ts";

export const scenarios: Record<ScenarioName, (run: Run) => Promise<void>> = { minting, handover, recovery, lease };
