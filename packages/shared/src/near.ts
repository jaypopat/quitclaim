import { JsonRpcProvider } from "near-api-js";
import { config } from "./config.ts";

export const nearProvider = new JsonRpcProvider({ url: config.near.rpcUrl });

export async function nearView<T>(contractId: string, method: string, args: object): Promise<T> {
  return (await nearProvider.callFunction({ contractId, method, args: args as Record<string, unknown> })) as T;
}
