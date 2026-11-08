/**
 * The funder's Sablier writes. Reads anyone can make live in `@quitclaim/shared/sablier.ts`.
 * Quitclaim never signs calls to Sablier: anyone pulls the stream into the lot, and the lot only
 * signs ERC-20 transfers of the token fixed at mint.
 */
import { erc20Abi, formatUnits, parseAbi, type Address, type Hex } from "viem";
import { config } from "@quitclaim/shared";
import { baseClient, tokenBalance } from "@quitclaim/shared/base.ts";
import { LOCKUP, lockup, streamCreated } from "@quitclaim/shared/sablier.ts";
import { funderAccount, wallet } from "./base.ts";

const faucetAbi = parseAbi(["function faucet()"]);

/**
 * A non-transferable linear stream of the lot token paying `recipient`, funded by the funder, who
 * draws on the token's faucet when short. Non-cancelable unless `cancelable` is set, which exists
 * only to show the contract refusing such a stream.
 */
export async function createStream(
  recipient: Address,
  amount: bigint,
  durationSec: number,
  { cancelable = false } = {},
) {
  const token = config.evm.token;
  const held = await tokenBalance(token, funderAccount().address);
  if (held < amount) {
    const faucet = await wallet()
      .writeContract({ address: token, abi: faucetAbi, functionName: "faucet" })
      .catch((cause) => {
        throw new Error(
          `funder holds ${formatUnits(held, 6)} USDC, the stream needs ${formatUnits(amount, 6)}, and the faucet refused (it mints once an hour per address)`,
          { cause },
        );
      });
    await baseClient.waitForTransactionReceipt({ hash: faucet });
  }
  const approve = await wallet().writeContract({
    address: token,
    abi: erc20Abi,
    functionName: "approve",
    args: [LOCKUP, amount],
  });
  await baseClient.waitForTransactionReceipt({ hash: approve });
  const tx = await wallet().writeContract({
    ...lockup,
    functionName: "createWithDurationsLL",
    args: [
      {
        sender: funderAccount().address,
        recipient,
        depositAmount: amount,
        token,
        cancelable,
        transferable: false,
        shape: "linear",
      },
      { start: 0n, cliff: 0n },
      0,
      { cliff: 0, total: durationSec },
    ],
  });
  const receipt = await baseClient.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success")
    throw new Error(`stream creation reverted: ${tx}`);
  return { ...streamCreated(receipt), tx };
}

/** Permissionless: moves whatever has vested into the lot. Returns null when nothing is withdrawable. */
export async function pull(id: bigint, lot: Address): Promise<Hex | null> {
  if (
    (await baseClient.readContract({
      ...lockup,
      functionName: "withdrawableAmountOf",
      args: [id],
    })) === 0n
  )
    return null;
  const fee = await baseClient.readContract({
    ...lockup,
    functionName: "calculateMinFeeWei",
    args: [id],
  });
  const tx = await wallet().writeContract({
    ...lockup,
    functionName: "withdrawMax",
    args: [id, lot],
    value: fee,
  });
  await baseClient.waitForTransactionReceipt({ hash: tx });
  return tx;
}
