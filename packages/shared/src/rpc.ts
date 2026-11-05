import { config } from "./config.ts";

/** JSON-RPC to NEAR with failover: a network error or 5xx moves on to the next URL. */
export async function nearRpc<T>(method: string, params: unknown, urls: readonly string[] = config.near.rpcUrls): Promise<T> {
  let last: unknown;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (res.status >= 500) {
        last = new Error(`${url} answered ${res.status}`);
        continue;
      }
      return (await res.json()) as T;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

type CallFunction = { result?: { result?: number[]; error?: string }; error?: unknown };

/** A NEAR view call, parsed as JSON. */
export async function nearView<T>(
  contractId: string,
  method: string,
  args: unknown,
  finality: "final" | "optimistic" = "optimistic",
  urls: readonly string[] = config.near.rpcUrls,
): Promise<T> {
  const body = await nearRpc<CallFunction>("query", {
    request_type: "call_function",
    finality,
    account_id: contractId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  }, urls);
  if (!body.result?.result) throw new Error(`${contractId}.${method} failed: ${JSON.stringify(body.result?.error ?? body.error)}`);
  return JSON.parse(Buffer.from(body.result.result).toString()) as T;
}
