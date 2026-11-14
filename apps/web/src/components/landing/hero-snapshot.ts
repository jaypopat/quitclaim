import type { HeroLot } from "@/lib/queries.ts";

/** Lot #7 as `quitclaim.testnet` returned it on 2026-11-14, so the hero paints before any read. */
export const HERO_SNAPSHOT: { id: number } & HeroLot = {
  id: 7,
  lot: {
    owner: "quitclaim-spike-43135.testnet",
    minter: "quitclaim-faucet-47905.testnet",
    path: "quitclaim-faucet-47905.testnet/eng-4y-cliff-mwc53bu7",
    address: "0x47b40bf7d001e3bea3ca203c6760c7b104bec714",
    token: "0x38d81431b9f76d9699af7517040d5221d9dea252",
    source: {
      contract: "0xa65a1ecef02c2b9bdc604951c6a6d02335d4532e",
      id: "196",
      kind: "sablier-lockup-v4",
      schedule: {
        deposit: "30000000",
        start: 1757682792,
        cliff: 1789218792,
        end: 1883826792,
        granularity: 1,
        start_unlock: "0",
        cliff_unlock: "7000000",
      },
    },
    state: "Clean",
    version: 1,
    next_nonce: 1,
    issued: [],
    next_seq: 1,
    sign_in_flight: false,
    royalty_bps: 250,
    listing: { item: "Title", price: "4000000000000000000000000", version: 1 },
    lease_offer: null,
    lease: null,
  },
  address: "0x47b40bf7d001e3bEA3Ca203c6760c7b104bec714",
  token: {
    address: "0x38d81431B9f76d9699AF7517040D5221D9dEA252",
    symbol: "USDC",
    decimals: 6,
  },
};
