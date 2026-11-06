/** No imports, so `freeze` can list the scenarios without loading their accounts and clients. */
export const scenarioNames = [
  "minting",
  "handover",
  "recovery",
  "lease",
] as const;
export type ScenarioName = (typeof scenarioNames)[number];
