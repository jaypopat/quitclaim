// Compile-time only: `bun check` fails if the generated types stop rejecting these.
import type { Kind, LotCalls, LotState, LotViews } from "./lot.gen.ts";

// @ts-expect-error not a lot state
export const badState: LotState = "Bogus";
// @ts-expect-error Claim needs a recipient
export const badKind: Kind = { Claim: {} };
// @ts-expect-error request_claim takes `to`, not `recipient`
export const badArgs: LotCalls["request_claim"]["args"] = { id: 0, recipient: "0x", gas_limit: 1, fees: { max_fee: "1", max_prio: "1" } };
// @ts-expect-error fees are required
export const noFees: LotCalls["seal"]["args"] = { id: 0 };
export const transferOptional: LotCalls["nft_transfer"]["args"] = { receiver_id: "bob.testnet", token_id: "0" };
export const proveIsBool: LotCalls["prove"]["result"] = true;
export const lotMayBeNull: LotViews["get_lot"]["result"] = null;
