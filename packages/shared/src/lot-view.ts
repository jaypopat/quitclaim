import { getAddress, type Address } from "viem";
import { fetchLotAddress } from "./address.ts";
import { baseClient, tokenBalance, tokenInfo } from "./base.ts";
import type { Lot } from "./lot.gen.ts";
import { getLot, holdsTestUsdc } from "./lot-views.ts";
import { titleSearch, withdrawn, type TitleSearch } from "./sablier.ts";

/** A minted lot with what Base and Sablier say about it right now. */
export type LotView = {
  id: number;
  lot: Lot;
  address: Address;
  token: { address: Address; symbol: string; decimals: number };
  base: {
    /** The lot token held at the lot address. */
    held: bigint;
    /** Transactions mined from the lot address. */
    nonce: number;
    /** Mined plus waiting in the mempool, so a broadcast shows before it mines. */
    pendingNonce: number;
  };
  stream: { withdrawn: bigint; title: TitleSearch };
  /** What MPC derives for the lot's path today; it must equal `address`. */
  derivedAddress: Address;
};

export async function fetchLotView(
  contract: string,
  id: number,
): Promise<LotView> {
  const lot = await getLot(contract, id);
  if (!lot?.address) throw new Error(`lot ${id} is not minted`);
  if (!holdsTestUsdc(lot))
    throw new Error(`lot ${id} holds an older test token`);
  const address = getAddress(lot.address);
  const token = getAddress(lot.token);
  const streamId = BigInt(lot.source.id);
  const [held, info, nonce, pendingNonce, pulled, title, derivedAddress] =
    await Promise.all([
      tokenBalance(token, address),
      tokenInfo(token),
      baseClient.getTransactionCount({ address, blockTag: "latest" }),
      baseClient.getTransactionCount({ address, blockTag: "pending" }),
      withdrawn(streamId),
      titleSearch(streamId, address, token),
      fetchLotAddress(contract, lot.path),
    ]);
  return {
    id,
    lot,
    address,
    token: info,
    base: { held, nonce, pendingNonce },
    stream: { withdrawn: pulled, title },
    derivedAddress: getAddress(derivedAddress),
  };
}
