import { FailoverRpcProvider, JsonRpcProvider } from "near-api-js";
import { config } from "./config.ts";

/** near-api-js failover across the configured RPCs; signed txs and views both go through it. */
export function nearProvider(urls: readonly string[] = config.near.rpcUrls) {
  return new FailoverRpcProvider(urls.map((url) => new JsonRpcProvider({ url })));
}

export async function nearView<T>(contractId: string, method: string, args: object, urls?: readonly string[]): Promise<T> {
  return (await nearProvider(urls).callFunction({ contractId, method, args: Object.fromEntries(Object.entries(args)) })) as T;
}
