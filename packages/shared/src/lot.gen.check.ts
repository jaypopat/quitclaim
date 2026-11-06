// Compile-time only: `bun check` fails if the generated types stop rejecting these. Each rejected
// value sits next to an accepted one that differs only in the field under test.
import type { Kind, LotCalls, LotState, LotViews } from "./lot.gen.ts";

export const goodState: LotState = "Clean";
// @ts-expect-error not a lot state
export const badState: LotState = "Bogus";

export const goodKind: Kind = { Transfer: { to: "0x", amount: "1" } };
// @ts-expect-error a transfer needs an amount
export const badKind: Kind = { Transfer: { to: "0x" } };

const fees = { max_fee: "1", max_prio: "1" };
export const goodArgs: LotCalls["request_transfer"]["args"] = {
  id: 0,
  to: "0x",
  amount: "1",
  gas_limit: 1,
  fees,
};
export const badArgs: LotCalls["request_transfer"]["args"] = {
  id: 0,
  // @ts-expect-error request_transfer takes `to`, not `recipient`
  recipient: "0x",
  amount: "1",
  gas_limit: 1,
  fees,
};

export const sealArgs: LotCalls["seal"]["args"] = { id: 0, fees };
// @ts-expect-error fees are required
export const noFees: LotCalls["seal"]["args"] = { id: 0 };

export const transferOptional: LotCalls["nft_transfer"]["args"] = {
  receiver_id: "bob.testnet",
  token_id: "0",
};
export const proveIsBool: LotCalls["prove"]["result"] = true;
export const lotMayBeNull: LotViews["get_lot"]["result"] = null;
export const mintMayRollBack: LotCalls["mint_proven"]["result"] = null;
