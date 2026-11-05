import type { Address, Hex } from "viem";
import type { Lot } from "@quitclaim/shared";
import * as base from "../base.ts";
import { env } from "../env.ts";
import { mustLot, pullSource, requestTransfer } from "../lot.ts";
import { call } from "../near.ts";

export const contract = env.lotContract();
export const alice = process.env.ALICE_ACCOUNT ?? env.deployer();
export const bob = process.env.BOB_ACCOUNT ?? `bob.${env.deployer()}`;
export const carol = process.env.CAROL_ACCOUNT ?? `carol.${env.deployer()}`;
export const minter = process.env.MINTER_ACCOUNT ?? env.deployer();
/** Proves and rescues; any account works, since both are permissionless. */
export const keeper = process.env.KEEPER_ACCOUNT ?? bob;
export const aliceEvm: Address = "0x000000000000000000000000000000000000a11c";
export const bobEvm: Address = "0x0000000000000000000000000000000000000b0b";

export const lotOf = (id: number): Promise<Lot> => mustLot(contract, id);

/** Anyone pulls the stream into the lot; then the owner signs a transfer of what the lot holds. */
export async function withdrawTo(signer: string, id: number, to: Address, override: Parameters<typeof requestTransfer>[4] = {}) {
  const pulled = await pullSource(await lotOf(id));
  const req = await requestTransfer(contract, signer, id, to, override);
  return { pulled, req, links: [...(pulled ? [`pull ${base.txUrl(pulled)}`] : []), req.url] };
}

export const transferTitle = (from: string, id: number, to = bob) =>
  call(from, contract, "nft_transfer", { receiver_id: to, token_id: String(id) }, { deposit: 1n });

export const raw = (outcome: { ok: boolean; value?: unknown }) => (outcome.ok ? ((outcome.value as Hex | null) ?? null) : null);
