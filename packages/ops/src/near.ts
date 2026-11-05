import { Account, actions, getTransactionLastResult, teraToGas, type KeyPairString } from "near-api-js";
import { nearProvider, nearView, type LotCalls, type LotViews } from "@quitclaim/shared";
import { env } from "./env.ts";

type Sent = { tx: string; url: string };
export type CallOutcome<T> = (Sent & { ok: true; value: T }) | (Sent & { ok: false; error: string });

const explorer = (tx: string) => `https://testnet.nearblocks.io/txns/${tx}`;

async function keyFor(accountId: string): Promise<KeyPairString> {
  const file = Bun.file(`${env.credentialsDir}/${accountId}.json`);
  if (!(await file.exists())) throw new Error(`no credentials for ${accountId} in ${env.credentialsDir}`);
  return (await file.json()).private_key;
}

export const provider = nearProvider;

export async function account(accountId: string): Promise<Account> {
  return new Account(accountId, provider(), await keyFor(accountId));
}


function failureMessage(status: unknown): string {
  const s = JSON.stringify(status);
  return s.match(/Smart contract panicked: ([^"\\]+)/)?.[1] ?? s;
}

/** Calls a lot-contract method and returns the outcome as data, including contract panics. */
export async function call<M extends keyof LotCalls>(
  signer: string,
  contractId: string,
  method: M,
  args: LotCalls[M]["args"],
  { deposit = 0n, tgas = 300 }: { deposit?: bigint; tgas?: number } = {},
): Promise<CallOutcome<LotCalls[M]["result"]>> {
  const acct = await account(signer);
  const res = await acct.signAndSendTransaction({
    receiverId: contractId,
    actions: [actions.functionCall(method, args, teraToGas(tgas), deposit)],
    waitUntil: "FINAL",
    throwOnFailure: false,
  });
  const sent = { tx: res.transaction.hash, url: explorer(res.transaction.hash) };
  if (typeof res.status === "object" && "Failure" in res.status) return { ...sent, ok: false, error: failureMessage(res.status) };
  return { ...sent, ok: true, value: (getTransactionLastResult(res) ?? null) as LotCalls[M]["result"] };
}

export function view<M extends keyof LotViews>(contractId: string, method: M, args: LotViews[M]["args"]): Promise<LotViews[M]["result"]> {
  return nearView(contractId, method, args);
}

export const getLot = (contractId: string, id: number) => view(contractId, "get_lot", { id });

export async function getFinality(contractId: string) {
  return (await view(contractId, "get_config", {})).finality;
}

export async function codeHash(accountId: string): Promise<string> {
  return (await provider().viewAccount({ accountId })).code_hash;
}
