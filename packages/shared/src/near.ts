import { JsonRpcProvider } from "near-api-js";
import { config } from "./config.ts";

export const nearProvider = new JsonRpcProvider({ url: config.near.rpcUrl });

export const nearTxUrl = (tx: string) => `${config.near.explorer}/txns/${tx}`;
export const nearAccountUrl = (account: string) =>
  `${config.near.explorer}/address/${account}`;

export async function nearView<T>(
  contractId: string,
  method: string,
  args: object,
): Promise<T> {
  return (await nearProvider.callFunction({
    contractId,
    method,
    args: args as Record<string, unknown>,
  })) as T;
}

export async function codeHash(accountId: string): Promise<string> {
  return (await nearProvider.viewAccount({ accountId })).code_hash;
}

export async function fullAccessKeys(accountId: string): Promise<string[]> {
  const { keys } = await nearProvider.viewAccessKeyList({ accountId });
  return keys
    .filter((k) => k.access_key.permission === "FullAccess")
    .map((k) => k.public_key);
}
