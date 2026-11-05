const PAGE_SIZE = 100;

/**
 * Fetch and inspect one page at a time, so discovering work has bounded RPC concurrency. A lease
 * token (`<id>-lease`) shares its lot with the title token, so only titles are inspected.
 */
export async function* pendingLots(
  readPage: (fromIndex: string, limit: number) => Promise<{ token_id: string }[]>,
  hasPending: (id: number) => Promise<boolean>,
) {
  let offset = 0n;
  for (;;) {
    const tokens = await readPage(offset.toString(), PAGE_SIZE);
    const ids = tokens.filter((token) => /^\d+$/.test(token.token_id)).map((token) => Number(token.token_id));
    const pending = await Promise.all(ids.map(hasPending));
    for (const [index, id] of ids.entries()) {
      if (pending[index]) yield id;
    }
    if (tokens.length < PAGE_SIZE) return;
    offset += BigInt(tokens.length);
  }
}
