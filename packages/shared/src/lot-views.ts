/**
 * Lot-contract views as the browser reads them: every result is parsed with zod at the RPC
 * boundary. Each schema is typed against the ABI-generated type, so a contract change that the
 * schema misses fails `bun check`.
 */
import { z } from "zod";
import { config } from "./config.ts";
import type {
  Issued,
  Lease,
  LeaseOffer,
  Listing,
  Lot,
  Schedule,
  Source,
} from "./lot.gen.ts";
import { nearView } from "./near.ts";

const u128 = z.string().regex(/^\d+$/);
const int = z.number().int().nonnegative();

const issued: z.ZodType<Issued> = z.object({
  seq: int,
  nonce: int,
  kind: z.union([
    z.literal("Burn"),
    z.object({ Transfer: z.object({ to: z.string(), amount: u128 }) }),
  ]),
  gas_limit: int,
  fees: z.object({ max_fee: u128, max_prio: u128 }),
  tx_hash: z.string().nullish(),
  raw_tx: z.string().nullish(),
});

const schedule: z.ZodType<Schedule> = z.object({
  deposit: u128,
  start: int,
  cliff: int,
  end: int,
  granularity: int.positive(),
  start_unlock: u128,
  cliff_unlock: u128,
});

const source: z.ZodType<Source> = z.object({
  contract: z.string(),
  id: u128,
  kind: z.string(),
  schedule,
});

const listing: z.ZodType<Listing> = z.object({
  item: z.enum(["Title", "Lease"]),
  price: u128,
  version: int,
});

const leaseOffer: z.ZodType<LeaseOffer> = z.object({
  price: u128,
  ends_at_ms: int,
  version: int,
});

const lease: z.ZodType<Lease> = z.object({
  holder: z.string(),
  start_ms: int,
  ends_at_ms: int,
  committed: u128,
});

const lot: z.ZodType<Lot> = z.object({
  owner: z.string(),
  minter: z.string(),
  path: z.string(),
  address: z.string().nullish(),
  token: z.string(),
  source,
  state: z.enum(["Minting", "Active", "Sealing", "Clean"]),
  version: int,
  next_nonce: int,
  issued: z.array(issued),
  next_seq: int,
  sign_in_flight: z.boolean(),
  royalty_bps: int,
  listing: listing.nullish(),
  lease_offer: leaseOffer.nullish(),
  lease: lease.nullish(),
});

const tokens = z.array(
  z.object({ token_id: z.string(), owner_id: z.string() }),
);

export type HeldToken = {
  lotId: number;
  item: "Title" | "Lease";
  owner: string;
};

/** Titles are `<id>`, live leases `<id>-lease`. */
function parseToken(t: z.infer<typeof tokens>[number]): HeldToken {
  const [, id, lease] = /^(\d+)(-lease)?$/.exec(t.token_id) ?? [];
  if (id === undefined) throw new Error(`unexpected token id ${t.token_id}`);
  return {
    lotId: Number(id),
    item: lease ? "Lease" : "Title",
    owner: t.owner_id,
  };
}

export async function getLot(contract: string, id: number) {
  return lot.nullable().parse(await nearView(contract, "get_lot", { id }));
}

const PAGE = 100;

async function paged(
  contract: string,
  method: "nft_tokens" | "nft_tokens_for_owner",
  args: object,
): Promise<HeldToken[]> {
  const found: HeldToken[] = [];
  for (let from = 0; ; from += PAGE) {
    const page = tokens.parse(
      await nearView(contract, method, {
        ...args,
        from_index: String(from),
        limit: PAGE,
      }),
    );
    found.push(...page.map(parseToken));
    if (page.length < PAGE) return found;
  }
}

/** Lots minted before the switch to Tidepool's test USDC hold an older test token. The app shows none of them. */
export const holdsTestUsdc = (lot: Lot) =>
  lot.token.toLowerCase() === config.evm.token.toLowerCase();

async function inTestUsdc(contract: string, held: HeldToken[]) {
  const ids = [...new Set(held.map((t) => t.lotId))];
  const lots = await Promise.all(ids.map((id) => getLot(contract, id)));
  const kept = new Set(ids.filter((_, i) => lots[i] && holdsTestUsdc(lots[i])));
  return held.filter((t) => kept.has(t.lotId));
}

/** Every title and live lease of a test USDC lot. */
export const allTokens = async (contract: string) =>
  inTestUsdc(contract, await paged(contract, "nft_tokens", {}));

/** The test USDC titles and leases `account` holds. */
export const tokensOf = async (contract: string, account: string) =>
  inTestUsdc(
    contract,
    await paged(contract, "nft_tokens_for_owner", { account_id: account }),
  );

export async function proceedsOf(contract: string, account: string) {
  return BigInt(
    u128.parse(
      await nearView(contract, "proceeds_of", { account_id: account }),
    ),
  );
}
