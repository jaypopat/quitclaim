import type { Address, Hex } from "viem";
import { nearToYocto } from "near-api-js";
import type { Lot, RequestTransferResult } from "@quitclaim/shared";
import * as base from "../base.ts";
import { env } from "../env.ts";
import { mustLot, pullSource, requestTransfer } from "../lot.ts";
import { call, view, YOCTO, type CallOutcome } from "../near.ts";

export const contract = env.lotContract();
export const alice = env.alice();
export const bob = env.bob();
export const carol = env.carol();
export const minter = env.minter();
/** Proves and rescues; any account works, since both are permissionless. */
export const keeper = env.keeper();
export const aliceEvm: Address = "0x000000000000000000000000000000000000a11c";
export const bobEvm: Address = "0x0000000000000000000000000000000000000b0b";
export const carolEvm: Address = "0x000000000000000000000000000000000000ca01";

export const PRICE = nearToYocto("0.1");
export const ROYALTY_BPS = 250;
export const royalty = (PRICE * BigInt(ROYALTY_BPS)) / 10_000n;

export const lotOf = (id: number): Promise<Lot> => mustLot(contract, id);

export const proceeds = async (account: string) =>
  BigInt(await view(contract, "proceeds_of", { account_id: account }));

/** Anyone pulls the stream into the lot; then the owner signs a transfer of what the lot holds. */
export async function withdrawTo(
  signer: string,
  id: number,
  to: Address,
  override: Parameters<typeof requestTransfer>[4] = {},
) {
  const pulled = await pullSource(await lotOf(id));
  const req = await requestTransfer(contract, signer, id, to, override);
  return {
    pulled,
    req,
    links: [...(pulled ? [`pull ${base.txUrl(pulled)}`] : []), req.url],
  };
}

export const transferTitle = (from: string, id: number, to = bob) =>
  call(
    from,
    contract,
    "nft_transfer",
    { receiver_id: to, token_id: String(id) },
    { deposit: YOCTO },
  );

export const raw = (outcome: CallOutcome<RequestTransferResult>) =>
  outcome.ok ? (outcome.value as Hex | null) : null;
