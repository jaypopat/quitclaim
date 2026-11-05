import { Account, actions, teraToGas } from "near-api-js";
import { config, type LotCalls, type LotViews } from "@quitclaim/shared";
import { env } from "./env.ts";

export type CallOutcome<T> = { tx: string; url: string; ok: true; value: T } | { tx: string; url: string; ok: false; error: string };

const explorer = (tx: string) => `https://testnet.nearblocks.io/txns/${tx}`;

async function keyFor(accountId: string): Promise<string> {
  const file = Bun.file(`${env.credentialsDir}/${accountId}.json`);
  if (!(await file.exists())) throw new Error(`no credentials for ${accountId} in ${env.credentialsDir}`);
  return (await file.json()).private_key;
}

export async function account(accountId: string): Promise<Account> {
  return new Account(accountId, config.near.rpcUrl, (await keyFor(accountId)) as never);
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
  const tx = res.transaction.hash;
  if ("Failure" in res.status) return { tx, url: explorer(tx), ok: false, error: failureMessage(res.status) };
  const raw = res.status.SuccessValue as string | undefined;
  const text = raw ? Buffer.from(raw, "base64").toString() : "";
  return { tx, url: explorer(tx), ok: true, value: (text ? JSON.parse(text) : null) as LotCalls[M]["result"] };
}

export async function view<M extends keyof LotViews>(contractId: string, method: M, args: LotViews[M]["args"]): Promise<LotViews[M]["result"]> {
  const res = await fetch(config.near.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query",
      params: {
        request_type: "call_function",
        finality: "optimistic",
        account_id: contractId,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      },
    }),
  });
  const body = (await res.json()) as { result?: { result?: number[]; error?: string }; error?: unknown };
  if (!body.result?.result) throw new Error(`${method} failed: ${JSON.stringify(body.result?.error ?? body.error)}`);
  return JSON.parse(Buffer.from(body.result.result).toString());
}

export const getLot = (contractId: string, id: number) => view(contractId, "get_lot", { id });

export async function getFinality(contractId: string) {
  const [, , finality] = await view(contractId, "get_config", {});
  return finality;
}
