import {
  Account,
  getTransactionLastResult,
  teraToGas,
  type KeyPairString,
} from "near-api-js";
import { ContractExecutionError } from "near-api-js/rpc-errors";
import {
  nearProvider,
  nearView,
  type LotCalls,
  type LotViews,
} from "@quitclaim/shared";
import { CALL_TGAS } from "@quitclaim/shared/calls.ts";
import { nearTxUrl } from "@quitclaim/shared/near.ts";
import { env } from "./env.ts";

type Sent = { tx: string; url: string };
export type CallOutcome<T> =
  (Sent & { ok: true; value: T }) | (Sent & { ok: false; error: string });

async function keyFor(accountId: string): Promise<KeyPairString> {
  const file = Bun.file(`${env.credentialsDir}/${accountId}.json`);
  if (!(await file.exists()))
    throw new Error(`no credentials for ${accountId} in ${env.credentialsDir}`);
  return (await file.json()).private_key;
}

export async function account(accountId: string): Promise<Account> {
  return new Account(accountId, nearProvider, await keyFor(accountId));
}

const sent = (res: { transaction: { hash: string } }): Sent => ({
  tx: res.transaction.hash,
  url: nearTxUrl(res.transaction.hash),
});

/** Calls a lot-contract method and returns the outcome as data, including contract panics. */
export async function call<M extends keyof LotCalls>(
  signer: string,
  contractId: string,
  method: M,
  args: LotCalls[M]["args"],
  { deposit = 0n, tgas = CALL_TGAS }: { deposit?: bigint; tgas?: number } = {},
): Promise<CallOutcome<LotCalls[M]["result"]>> {
  const acct = await account(signer);
  try {
    const res = await acct.callFunctionRaw({
      contractId,
      methodName: method,
      args,
      deposit,
      gas: teraToGas(tgas),
      waitUntil: "FINAL",
    });
    return {
      ...sent(res),
      ok: true,
      value: (getTransactionLastResult(res) ?? null) as LotCalls[M]["result"],
    };
  } catch (e) {
    if (!(e instanceof ContractExecutionError) || !e.transactionResult) throw e;
    return { ...sent(e.transactionResult), ok: false, error: e.message };
  }
}

export function view<M extends keyof LotViews>(
  contractId: string,
  method: M,
  args: LotViews[M]["args"],
): Promise<LotViews[M]["result"]> {
  return nearView(contractId, method, args);
}

export const getLot = (contractId: string, id: number) =>
  view(contractId, "get_lot", { id });

export async function getFinality(contractId: string) {
  return (await view(contractId, "get_config", {})).finality;
}
