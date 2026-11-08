import type { StreamCreation } from "@quitclaim/shared/sablier.ts";
import type { Address } from "viem";

/** A position's name, resale royalty, and the lot address MPC derives for `<minter>/<name>`. */
export type Receiving = {
  name: string;
  royaltyBps: number;
  path: string;
  address: Address;
};

/** Each step holds exactly what the steps before it established. */
export type Wizard =
  | { step: "address" }
  | { step: "stream"; receiving: Receiving }
  | { step: "mint"; receiving: Receiving; stream: StreamCreation }
  | { step: "done"; receiving: Receiving; lotId: number };

export const STEPS = ["Address", "Employer stream", "Mint title"] as const;
