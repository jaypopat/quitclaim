import type { Issued, Lot } from "./lot.gen.ts";
import type { LotView } from "./lot-view.ts";

export const T0 = 1_800_000_000;
export const ADDRESS = "0x00000000000000000000000000000000000000Aa";
export const TOKEN = "0x38d81431B9f76d9699AF7517040D5221D9dEA252";

/** A minted lot paying 100 tUSDC over 1000 s from T0, owned by alice. */
export function lot(overrides: Partial<Lot> = {}): Lot {
  return {
    owner: "alice.testnet",
    minter: "minter.testnet",
    path: "minter.testnet/grant",
    address: ADDRESS,
    token: TOKEN,
    source: {
      kind: "sablier-lockup-v4",
      contract: "0xa65a1ecef02c2b9bdc604951c6a6d02335d4532e",
      id: "7",
      schedule: {
        deposit: "100000000",
        start: T0,
        cliff: 0,
        end: T0 + 1000,
        granularity: 1,
        start_unlock: "0",
        cliff_unlock: "0",
      },
    },
    state: "Active",
    version: 3,
    next_nonce: 0,
    issued: [],
    next_seq: 0,
    sign_in_flight: false,
    royalty_bps: 250,
    listing: null,
    lease_offer: null,
    lease: null,
    ...overrides,
  };
}

export function issued(overrides: Partial<Issued> = {}): Issued {
  return {
    seq: 0,
    nonce: 0,
    kind: "Burn",
    gas_limit: 21_000,
    fees: { max_fee: "1000", max_prio: "100" },
    tx_hash: null,
    raw_tx: null,
    ...overrides,
  };
}

export function view(
  l: Lot = lot(),
  overrides: Partial<Omit<LotView, "lot">> = {},
): LotView {
  return {
    id: 4,
    lot: l,
    address: ADDRESS,
    token: { address: TOKEN, symbol: "USDC", decimals: 6 },
    base: { held: 0n, nonce: l.next_nonce, pendingNonce: l.next_nonce },
    stream: {
      withdrawn: 0n,
      title: {
        recipientIsLot: true,
        cancelable: false,
        transferable: false,
        tokenMatches: true,
        clean: true,
      },
    },
    derivedAddress: ADDRESS,
    ...overrides,
  };
}
