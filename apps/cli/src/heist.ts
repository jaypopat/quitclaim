import { logger } from "@quitclaim/sdk/logger.ts";
import {
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  parseTransaction,
  recoverTransactionAddress,
  type Hex,
  type TransactionSerializedEIP1559,
} from "viem";
import { config, type Finality } from "@quitclaim/shared";
import { txUrl as baseTxUrl } from "@quitclaim/sdk/base.ts";
import { nearTxUrl } from "@quitclaim/sdk/near.ts";
import { parseEvidence, type HeistEvidence } from "./heist-evidence.ts";
import {
  observe,
  replay,
  requireFact,
  same,
  type NearHistory,
  type Observation,
  type Replay,
} from "./heist-observe.ts";

type VerifyArgs = {
  request: {
    domain_id: number;
    request: { Base: { tx_id: string; finality: Finality } };
  };
};
type Nep171Event = {
  standard: string;
  event: string;
  data: { old_owner_id: string; new_owner_id: string; token_ids: string[] }[];
};
export type HeistIO = {
  observe: (e: HeistEvidence) => Promise<Observation>;
  replay: (raw: TransactionSerializedEIP1559) => Promise<Replay>;
  log: (line: string) => void;
};

function transfer(data: Hex) {
  const call = decodeFunctionData({ abi: erc20Abi, data });
  if (call.functionName !== "transfer")
    throw new Error("expected ERC-20 transfer");
  const [to, amount] = call.args;
  requireFact(amount > 0n, "transfer amount must be positive");
  const encoded = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, amount],
  });
  requireFact(
    encoded.toLowerCase() === data.toLowerCase(),
    "transfer has trailing calldata",
  );
  return { to, amount };
}

function successfulCall(
  history: NearHistory,
  contract: string,
  method: string,
) {
  requireFact(history.success, `NEAR ${method} transaction failed`);
  requireFact(
    history.receiver === contract,
    `NEAR ${method} targets another contract`,
  );
  const call = history.calls.find(
    (call) =>
      call.receiver === contract &&
      call.predecessor === history.signer &&
      call.method === method,
  );
  if (!call?.ok) throw new Error(`missing successful ${method} receipt`);
  return call;
}

async function checkSignedTransfer(evidence: HeistEvidence) {
  const transaction = parseTransaction(evidence.retained);
  requireFact(
    transaction.chainId === config.evm.chainId,
    "signed withdrawal uses the wrong chain",
  );
  const sender = await recoverTransactionAddress({
    serializedTransaction: evidence.retained,
  });
  requireFact(
    same(sender, evidence.lot.address),
    "retained signature is not from the lot",
  );
  requireFact(
    same(transaction.to ?? null, evidence.lot.token),
    "signed withdrawal targets another token",
  );
  requireFact(
    (transaction.value ?? 0n) === 0n,
    "signed withdrawal sends native ETH",
  );
  const payment = transfer(transaction.data ?? "0x");
  requireFact(
    same(payment.to, evidence.seller.evm),
    "signed withdrawal does not pay the seller",
  );
  return {
    sender,
    nonce: transaction.nonce ?? 0,
    amount: payment.amount,
  };
}

type SignedTransfer = Awaited<ReturnType<typeof checkSignedTransfer>>;

function checkLot(
  evidence: HeistEvidence,
  observed: Observation,
  signed: SignedTransfer,
) {
  requireFact(
    observed.chainId === config.evm.chainId,
    "RPC is on the wrong chain",
  );
  requireFact(
    observed.codeHash === evidence.codeHash,
    "deployed code differs from the published evidence",
  );
  requireFact(
    observed.finality === evidence.finality,
    "contract finality differs from the published evidence",
  );
  requireFact(
    same(observed.lot.address, signed.sender),
    "live lot address differs from the signature",
  );
  requireFact(
    same(observed.derivedAddress, signed.sender),
    "MPC-derived address differs from the signature",
  );
  requireFact(
    same(observed.lot.token, evidence.lot.token),
    "live lot uses another token",
  );
  requireFact(
    observed.lot.nextNonce > signed.nonce,
    "NEAR has not confirmed nonce consumption; replay skipped",
  );
  requireFact(
    observed.nonce > signed.nonce,
    "Base nonce is unconsumed; replay skipped",
  );
}

function checkBurn(observed: Observation, signed: SignedTransfer) {
  const burn = observed.consumer;
  requireFact(burn.success, "burn transaction reverted");
  requireFact(burn.canonical, "burn block is not canonical");
  requireFact(
    same(burn.from, signed.sender),
    "burn was sent by another account",
  );
  requireFact(burn.nonce === signed.nonce, "burn consumed another nonce");
  requireFact(same(burn.to, signed.sender), "burn is not a self-transfer");
  requireFact(burn.value === 0n, "burn sends ETH");
  requireFact(burn.data === "0x", "burn has unexpected calldata");
  requireFact(
    observed.safeHead >= burn.block,
    "burn has not reached Base Safe; replay skipped",
  );
}

function checkProof(
  evidence: HeistEvidence,
  observed: Observation,
  nonce: number,
) {
  const proof = observed.proof;
  const call = successfulCall(proof, evidence.contract, "prove");
  requireFact(call.args.id === evidence.lot.id, "proof concerns another lot");
  requireFact(
    proof.signer === evidence.proof.signer,
    "proof signer differs from the evidence",
  );
  requireFact(proof.value === "true", "proof did not consume a nonce");
  const mpc = proof.calls.find(
    (call) =>
      call.receiver === config.near.mpcSigner &&
      call.predecessor === evidence.contract &&
      call.method === "verify_foreign_transaction",
  );
  if (!mpc?.ok) throw new Error("missing successful MPC verification receipt");
  const { request } = mpc.args as VerifyArgs;
  const base = request.request.Base;
  requireFact(
    base.tx_id === evidence.consumingTx.slice(2),
    "MPC verified another consuming transaction",
  );
  requireFact(
    base.finality === evidence.finality,
    "MPC proof uses another finality",
  );
  requireFact(
    request.domain_id === config.near.foreignTxDomain,
    "MPC proof uses another domain",
  );
  const callback = proof.calls.find(
    (call) =>
      call.receiver === evidence.contract &&
      call.predecessor === evidence.contract &&
      call.method === "on_proved" &&
      call.args.id === evidence.lot.id &&
      call.args.nonce === nonce,
  );
  requireFact(
    callback?.ok === true && callback.value === "true",
    "nonce proof callback did not succeed",
  );
  requireFact(
    observed.consumer.timestamp <= proof.timestamp,
    "proof predates the burn",
  );
}

function checkSale(evidence: HeistEvidence, observed: Observation) {
  const sale = observed.sale;
  const call = successfulCall(sale, evidence.contract, "buy");
  requireFact(
    call.args.id === evidence.lot.id,
    "purchase concerns another lot",
  );
  requireFact(
    sale.signer === evidence.buyer.near,
    "purchase was signed by another buyer",
  );
  requireFact(
    sale.signer === evidence.sale.signer,
    "purchase signer differs from the evidence",
  );
  requireFact(
    evidence.seller.near !== evidence.buyer.near,
    "buyer and seller are the same account",
  );
  const titleChanged = sale.logs
    .filter((log) => log.startsWith("EVENT_JSON:"))
    .some((log) => {
      const event: Nep171Event = JSON.parse(log.slice("EVENT_JSON:".length));
      if (event.standard !== "nep171" || event.event !== "nft_transfer")
        return false;
      return event.data.some(
        (transfer) =>
          transfer.old_owner_id === evidence.seller.near &&
          transfer.new_owner_id === evidence.buyer.near &&
          transfer.token_ids.includes(String(evidence.lot.id)),
      );
    });
  requireFact(
    titleChanged,
    "purchase has no matching seller-to-buyer title transfer",
  );
  requireFact(
    observed.proof.height < sale.height,
    "purchase predates the proof",
  );
}

function checkBuyerPaid(
  evidence: HeistEvidence,
  observed: Observation,
  signed: SignedTransfer,
) {
  const withdrawal = observed.withdrawal;
  requireFact(withdrawal.success, "buyer withdrawal reverted");
  requireFact(withdrawal.canonical, "buyer withdrawal block is not canonical");
  requireFact(
    same(withdrawal.from, signed.sender),
    "buyer withdrawal came from another address",
  );
  requireFact(
    same(withdrawal.to, evidence.lot.token),
    "buyer withdrawal targets another token",
  );
  requireFact(withdrawal.value === 0n, "buyer withdrawal sends native ETH");
  requireFact(
    withdrawal.nonce > signed.nonce,
    "buyer withdrawal predates nonce consumption",
  );
  const payment = transfer(withdrawal.data);
  requireFact(
    same(payment.to, evidence.buyer.evm),
    "withdrawal pays another recipient",
  );
  requireFact(
    withdrawal.transfers.some(
      (transfer) =>
        same(transfer.from, signed.sender) &&
        same(transfer.to, evidence.buyer.evm) &&
        transfer.amount === payment.amount,
    ),
    "missing matching token payment event",
  );
  requireFact(
    observed.sale.timestamp <= withdrawal.timestamp,
    "buyer withdrawal predates the purchase",
  );
  return payment.amount;
}

function tokenAmount(amount: bigint, token: Observation["tokenInfo"]) {
  const precision = Math.min(token.decimals, 2);
  const divisor = 10n ** BigInt(token.decimals - precision);
  const rounded = (amount + divisor / 2n) / divisor;
  return `${formatUnits(rounded, precision)} ${token.symbol}`;
}

export async function verifyHeist(
  evidence: HeistEvidence,
  io: HeistIO = { observe, replay, log: console.log },
): Promise<void> {
  io.log("Quitclaim heist: can Alice still spend from the lot she sold?");
  io.log(`Alice (seller): ${evidence.seller.near}`);
  io.log(`Bob (buyer): ${evidence.buyer.near}`);
  const signed = await checkSignedTransfer(evidence);
  const observed = await io.observe(evidence);
  checkLot(evidence, observed, signed);
  io.log(
    `Alice kept a signed withdrawal for about ${tokenAmount(signed.amount, observed.tokenInfo)}, Base nonce ${signed.nonce}.`,
  );

  checkBurn(observed, signed);
  io.log(
    `PASS nonce ${signed.nonce} burned on Base: ${baseTxUrl(evidence.consumingTx)}`,
  );
  checkProof(evidence, observed, signed.nonce);
  io.log(`PASS NEAR MPC verified the burn: ${nearTxUrl(evidence.proof.hash)}`);
  checkSale(evidence, observed);
  io.log(`PASS Bob bought Alice's title: ${nearTxUrl(evidence.sale.hash)}`);
  const amount = checkBuyerPaid(evidence, observed, signed);
  io.log(
    `PASS Bob withdrew about ${tokenAmount(amount, observed.tokenInfo)}: ${baseTxUrl(evidence.buyerWithdrawal)}`,
  );

  io.log("Broadcasting Alice's signed withdrawal once...");
  const result = await io.replay(evidence.retained);
  if (result.kind !== "nonce-consumed")
    throw new Error(`Replay failed: ${result.message}`);
  io.log(`Base rejected it: ${result.message}`);
  io.log(
    `PASS Alice's retained withdrawal was rejected. Current owner: ${observed.lot.owner}.`,
  );
  const policy =
    observed.fullAccessKeys === 0
      ? "contract frozen"
      : `contract upgradeable, ${observed.fullAccessKeys} full-access ${observed.fullAccessKeys === 1 ? "key" : "keys"}`;
  io.log(`Evidence: ${evidence.finality} MPC finality; ${policy}.`);
}

if (import.meta.main) {
  try {
    const args = Bun.argv.slice(2);
    if (args.length > 1)
      throw new Error("usage: bun run heist [evidence.json]");
    const file =
      args[0] ??
      new URL("../../../reports/heist.json", import.meta.url).pathname;
    await verifyHeist(parseEvidence(await Bun.file(file).json()));
  } catch (error) {
    logger.error({ err: error, command: "heist" }, "FAIL heist");
    process.exitCode = 1;
  }
}
