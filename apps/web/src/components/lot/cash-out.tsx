import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { erc20Abi, formatUnits, isHash } from "viem";
import type { LotAction } from "@quitclaim/shared/actions.ts";
import {
  baseClient,
  estimateTransferGas,
  floorFees,
} from "@quitclaim/shared/base.ts";
import {
  executionStatus,
  quote,
  Status,
  submitDeposit,
} from "@quitclaim/shared/intents.ts";
import { getLot } from "@quitclaim/shared/lot-views.ts";
import type { LotView } from "@quitclaim/shared/lot-view.ts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readCashOut, saveCashOut, useCashOutRecord } from "@/lib/cash-out.ts";
import { LOT_CONTRACT } from "@/lib/contract.ts";
import { tokenAmount } from "@/lib/inputs.ts";
import type { useSend } from "@/lib/use-send.ts";

type Withdraw = Extract<LotAction, { kind: "withdraw" }>;

/** A quote remains recorded through wallet redirects and after the keeper removes `issued`. */
export function CashOut({
  view,
  action,
  send,
}: {
  view: LotView;
  action: Withdraw | undefined;
  send: ReturnType<typeof useSend>;
}) {
  const { id, lot } = view;
  const [amount, setAmount] = useState("");
  const record = useCashOutRecord(id);
  const status = useQuery({
    queryKey: ["cash-out-status", record?.depositAddress],
    queryFn: async () => {
      if (!record) throw new Error("No cash-out record");
      let hash = record.txHash;
      if (!hash) {
        const head = await baseClient.getBlockNumber();
        for (
          let from = BigInt(record.fromBlock);
          from <= head;
          from += 50_000n
        ) {
          const logs = await baseClient.getContractEvents({
            address: view.token.address,
            abi: erc20Abi,
            eventName: "Transfer",
            args: { from: view.address, to: record.depositAddress },
            fromBlock: from,
            toBlock: from + 49_999n < head ? from + 49_999n : head,
          });
          const paid = logs.find(
            (log) => log.args.value === BigInt(record.amount),
          );
          if (paid) {
            hash = paid.transactionHash;
            saveCashOut(id, { ...record, txHash: hash });
            break;
          }
        }
      }
      if (hash && isHash(hash))
        await submitDeposit(hash, record.depositAddress);
      return executionStatus(record.depositAddress);
    },
    enabled: !!record?.approvalStarted,
    refetchInterval: ({ state }) =>
      state.data?.status === Status.SUCCESS ||
      state.data?.status === Status.REFUNDED
        ? false
        : 5_000,
    retry: false,
  });
  const prepare = useMutation({
    mutationFn: () =>
      navigator.locks.request(`cash-out:${LOT_CONTRACT}:${id}`, async () => {
        if (readCashOut(id))
          throw new Error(
            "This lot already has a recorded quote. Resolve it before requesting another.",
          );
        const fresh = await getLot(LOT_CONTRACT, id);
        if (
          !fresh ||
          fresh.owner !== lot.owner ||
          fresh.version !== lot.version ||
          fresh.lease ||
          fresh.state !== "Active" ||
          fresh.issued.length ||
          fresh.sign_in_flight
        )
          throw new Error(
            "Cash-out requires an Active, unleased lot with nothing issued. Refresh the lot first.",
          );
        const units = tokenAmount(view.token.decimals, view.base.held).parse(
          amount,
        );
        const fromBlock = await baseClient.getBlockNumber();
        const result = await quote(units, view.address, lot.owner);
        if (BigInt(result.quote.amountIn) !== units)
          throw new Error("Tidepool changed the requested input amount.");
        saveCashOut(id, {
          depositAddress: result.quote.depositAddress,
          recipient: lot.owner,
          amount: result.quote.amountIn,
          payout: result.quote.amountOut,
          deadline: result.quote.deadline,
          approvalStarted: false,
          fromBlock: String(fromBlock),
        });
      }),
  });
  const resolved =
    status.data?.status === Status.SUCCESS ||
    status.data?.status === Status.REFUNDED;
  const ready =
    (!record || record.recipient === lot.owner) &&
    !!action &&
    !lot.lease &&
    !lot.issued.length &&
    !lot.sign_in_flight;
  return (
    <div className="flex flex-col gap-3 border p-4">
      <h3 className="font-medium">Cash out to NEAR</h3>
      <p className="text-xs text-muted-foreground">
        Tidepool swaps test USDC for test wNEAR (no value). Its relayer holds
        the deposit while the swap runs.
      </p>
      {record ? (
        <>
          <p className="text-sm break-all">
            {formatUnits(BigInt(record.amount), 6)} USDC → approximately{" "}
            {formatUnits(BigInt(record.payout), 24)} test wNEAR to{" "}
            {record.recipient}
          </p>
          <p className="font-mono text-xs break-all">
            Deposit: {record.depositAddress}
          </p>
          {record.approvalStarted ? (
            <>
              <p role="status" className="text-sm">
                {status.data?.status ?? "Checking Tidepool…"}
              </p>
              {status.error && (
                <p role="alert" className="text-sm text-destructive">
                  {status.error.message}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                This payment stays recorded in this browser. Keep browser data
                until it resolves. Do not pay again from another device. If
                wallet approval was cancelled, seal the lot and confirm the
                nonce is consumed before recovering manually.
              </p>
              {resolved && !lot.issued.length && !lot.sign_in_flight && (
                <Button variant="outline" onClick={() => saveCashOut(id, null)}>
                  Dismiss completed cash-out
                </Button>
              )}
            </>
          ) : (
            <>
              <p className="text-xs">
                Quote expires {new Date(record.deadline).toLocaleString()}.
              </p>
              <Button
                disabled={
                  !ready ||
                  send.isPending ||
                  Date.parse(record.deadline) <= Date.now()
                }
                onClick={() =>
                  send.mutate(async () =>
                    navigator.locks.request(
                      `cash-out:${LOT_CONTRACT}:${id}`,
                      async () => {
                        const current = readCashOut(id);
                        if (
                          !action ||
                          !current ||
                          current.approvalStarted ||
                          current.depositAddress !== record.depositAddress
                        )
                          throw new Error(
                            "Quote changed. Refresh before approving.",
                          );
                        if (Date.parse(current.deadline) <= Date.now())
                          throw new Error(
                            "Quote expired. Discard it and request another.",
                          );
                        const [gas, floor] = await Promise.all([
                          estimateTransferGas(
                            view.token.address,
                            view.address,
                            current.depositAddress,
                            BigInt(current.amount),
                          ),
                          floorFees(),
                        ]);
                        const latest = readCashOut(id);
                        if (
                          !latest ||
                          latest.depositAddress !== current.depositAddress ||
                          latest.approvalStarted
                        )
                          throw new Error(
                            "Quote changed during fee estimation.",
                          );
                        saveCashOut(id, { ...current, approvalStarted: true });
                        return action.call({
                          to: current.depositAddress,
                          amount: BigInt(current.amount),
                          gasLimit: Number(gas),
                          floor,
                        });
                      },
                    ),
                  )
                }
              >
                Approve cash-out in wallet
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  void navigator.locks.request(
                    `cash-out:${LOT_CONTRACT}:${id}`,
                    () => {
                      const current = readCashOut(id);
                      if (current && !current.approvalStarted)
                        saveCashOut(id, null);
                    },
                  )
                }
              >
                Discard unpaid quote
              </Button>
            </>
          )}
        </>
      ) : (
        <>
          <label className="text-sm" htmlFor={`cash-out-${id}`}>
            Amount in test USDC
          </label>
          <Input
            id={`cash-out-${id}`}
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <Button
            disabled={!ready || prepare.isPending || send.isPending}
            onClick={() => prepare.mutate()}
          >
            {prepare.isPending ? "Getting quote…" : "Get cash-out quote"}
          </Button>
          {prepare.error && (
            <p role="alert" className="text-sm text-destructive">
              {prepare.error.message}
            </p>
          )}
          {!ready && (
            <p className="text-xs text-muted-foreground">
              Unseal the lot and settle outstanding transactions first.
            </p>
          )}
        </>
      )}
    </div>
  );
}
