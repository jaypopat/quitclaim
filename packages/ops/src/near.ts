import { Account, FailoverRpcProvider, JsonRpcProvider, actions, teraToGas } from "near-api-js";
import { config, nearRpc, nearView, type LotCalls, type LotViews } from "@quitclaim/shared";
import { env } from "./env.ts";

type Sent = { tx: string; url: string };
export type CallOutcome<T> = (Sent & { ok: true; value: T }) | (Sent & { ok: false; error: string });

const explorer = (tx: string) => `https://testnet.nearblocks.io/txns/${tx}`;

async function keyFor(accountId: string): Promise<string> {
  const file = Bun.file(`${env.credentialsDir}/${accountId}.json`);
  if (!(await file.exists())) throw new Error(`no credentials for ${accountId} in ${env.credentialsDir}`);
  return (await file.json()).private_key;
}

/** Signed txs fail over too. Resending the same signed tx is safe: NEAR dedupes by tx hash. */
export const provider = () => new FailoverRpcProvider(config.near.rpcUrls.map((url) => new JsonRpcProvider({ url })));

export async function account(accountId: string): Promise<Account> {
  return new Account(accountId, provider(), (await keyFor(accountId)) as never);
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
  const res = (await acct.signAndSendTransaction({
    receiverId: contractId,
    actions: [actions.functionCall(method, args, teraToGas(tgas), deposit)],
    waitUntil: "FINAL",
    throwOnFailure: false,
  })) as { transaction: { hash: string }; status: Record<string, unknown> };
  const sent = { tx: res.transaction.hash, url: explorer(res.transaction.hash) };
  if ("Failure" in res.status) return { ...sent, ok: false, error: failureMessage(res.status) };
  const raw = res.status.SuccessValue as string | undefined;
  const text = raw ? Buffer.from(raw, "base64").toString() : "";
  return { ...sent, ok: true, value: (text ? JSON.parse(text) : null) as LotCalls[M]["result"] };
}

export function view<M extends keyof LotViews>(contractId: string, method: M, args: LotViews[M]["args"]): Promise<LotViews[M]["result"]> {
  return nearView(contractId, method, args);
}

export const getLot = (contractId: string, id: number) => view(contractId, "get_lot", { id });

export async function getFinality(contractId: string) {
  const [, , finality] = await view(contractId, "get_config", {});
  return finality;
}

export async function codeHash(accountId: string): Promise<string> {
  const body = await nearRpc<{ result?: { code_hash?: string }; error?: unknown }>("query", {
    request_type: "view_account",
    finality: "final",
    account_id: accountId,
  });
  if (typeof body.result?.code_hash !== "string") throw new Error(`view_account failed for ${accountId}: ${JSON.stringify(body.error ?? body)}`);
  return body.result.code_hash;
}
