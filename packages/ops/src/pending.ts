const PAGE_SIZE = 100;

/**
 * Every pending lot, found before the caller settles any: settling closes leases, which shrinks
 * the enumeration under a later page's offset. One page is fetched and inspected at a time, so
 * discovery has bounded RPC concurrency. A lease token (`<id>-lease`) shares its lot with the
 * title token, so only titles are inspected.
 */
export async function pendingLots(
  readPage: (fromIndex: string, limit: number) => Promise<{ token_id: string }[]>,
  hasPending: (id: number) => Promise<boolean>,
) {
  const found: number[] = [];
  let offset = 0n;
  for (;;) {
    const tokens = await readPage(offset.toString(), PAGE_SIZE);
    const ids = tokens.filter((token) => /^\d+$/.test(token.token_id)).map((token) => Number(token.token_id));
    const pending = await Promise.all(ids.map(hasPending));
    found.push(...ids.filter((_, index) => pending[index]));
    if (tokens.length < PAGE_SIZE) return found;
    offset += BigInt(tokens.length);
  }
}
