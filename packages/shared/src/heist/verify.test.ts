import { expect, test } from "bun:test";
import { encodeFunctionData, erc20Abi, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { config } from "../config.ts";
import { parseEvidence, type HeistEvidence } from "./evidence.ts";
import { replayError, type Observation } from "./observe.ts";
import { verifyHeist, type HeistIO } from "./verify.ts";

const published = parseEvidence(
  await Bun.file(
    new URL("../../../../reports/heist.json", import.meta.url),
  ).json(),
);
const token = "0x0000000000000000000000000000000000000010";
const seller = "0x0000000000000000000000000000000000000011";
const buyer = "0x0000000000000000000000000000000000000012";
const other = "0x0000000000000000000000000000000000000013";

async function fixture(
  overrides: {
    chainId?: number;
    target?: typeof token | typeof other;
    data?: Hex;
    value?: bigint;
  } = {},
) {
  const account = privateKeyToAccount(generatePrivateKey());
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [seller, 10n],
  });
  const retained = await account.signTransaction({
    type: "eip1559",
    chainId: overrides.chainId ?? 84532,
    nonce: 1,
    to: overrides.target ?? token,
    data: overrides.data ?? data,
    value: overrides.value ?? 0n,
    gas: 80000n,
    maxFeePerGas: 3000000000n,
    maxPriorityFeePerGas: 1000000000n,
  });
  const evidence = parseEvidence({
    ...published,
    lot: { id: 2, address: account.address, token },
    seller: { near: "alice.testnet", evm: seller },
    buyer: { near: "bob.testnet", evm: buyer },
    proof: { ...published.proof, signer: "bob.testnet" },
    sale: { ...published.sale, signer: "bob.testnet" },
    retained,
  });
  const observation: Observation = {
    chainId: 84532,
    codeHash: evidence.codeHash,
    finality: evidence.finality,
    fullAccessKeys: 1,
    lot: {
      address: account.address,
      token,
      path: "alice.testnet/grant",
      nextNonce: 3,
      owner: "carol.testnet",
    },
    derivedAddress: account.address,
    nonce: 3,
    safeHead: 100n,
    consumer: {
      from: account.address,
      to: account.address,
      nonce: 1,
      value: 0n,
      data: "0x",
      success: true,
      canonical: true,
      block: 50n,
      timestamp: 10n,
      transfers: [],
    },
    withdrawal: {
      from: account.address,
      to: token,
      nonce: 2,
      value: 0n,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [buyer, 20n],
      }),
      success: true,
      canonical: true,
      block: 60n,
      timestamp: 40n,
      transfers: [{ from: account.address, to: buyer, amount: 20n }],
    },
    proof: {
      receiver: evidence.contract,
      signer: "bob.testnet",
      success: true,
      value: "true",
      height: 10,
      timestamp: 20n,
      logs: [],
      calls: [
        {
          receiver: evidence.contract,
          predecessor: "bob.testnet",
          method: "prove",
          args: { id: 2, seq: 2 },
          ok: true,
          value: null,
        },
        {
          receiver: config.near.mpcSigner,
          predecessor: evidence.contract,
          method: "verify_foreign_transaction",
          ok: true,
          value: null,
          args: {
            request: {
              request: {
                Base: {
                  tx_id: evidence.consumingTx.slice(2),
                  finality: evidence.finality,
                },
              },
              domain_id: 3,
            },
          },
        },
        {
          receiver: evidence.contract,
          predecessor: evidence.contract,
          method: "on_proved",
          args: { id: 2, nonce: 1 },
          ok: true,
          value: "true",
        },
      ],
    },
    sale: {
      receiver: evidence.contract,
      signer: "bob.testnet",
      success: true,
      value: "",
      height: 20,
      timestamp: 30n,
      calls: [
        {
          receiver: evidence.contract,
          predecessor: "bob.testnet",
          method: "buy",
          args: { id: 2 },
          ok: true,
          value: "",
        },
      ],
      logs: [
        `EVENT_JSON:${JSON.stringify({ standard: "nep171", event: "nft_transfer", data: [{ old_owner_id: "alice.testnet", new_owner_id: "bob.testnet", token_ids: ["2"] }] })}`,
      ],
    },
    tokenInfo: { symbol: "QTT", decimals: 0 },
  };
  let replays = 0;
  const lines: string[] = [];
  const io: HeistIO = {
    observe: async () => observation,
    replay: async () => {
      replays++;
      return { kind: "nonce-consumed", message: "nonce too low" };
    },
    log: (line) => lines.push(line),
  };
  return { evidence, observation, io, lines, replays: () => replays };
}

test("verifies a historical handover after resale and replays exactly once", async () => {
  const f = await fixture();
  await verifyHeist(f.evidence, f.io);
  expect(f.replays()).toBe(1);
  expect(f.lines.some((line) => line.includes("carol.testnet"))).toBe(true);
  expect(
    f.lines.some((line) =>
      line.startsWith("PASS Alice's retained withdrawal was rejected."),
    ),
  ).toBe(true);
  expect(f.lines.some((line) => line.includes("about 10 QTT"))).toBe(true);
});

test("rejects unsupported and malformed evidence", () => {
  for (const evidence of [
    null,
    { ...published, version: 2 },
    { ...published, chainId: 1 },
    { ...published, retained: "0x01" },
    { ...published, lot: { ...published.lot, id: -1 } },
  ]) {
    expect(() => parseEvidence(evidence)).toThrow();
  }
});

test("wrong signed chain, token, native value, or calldata never reaches replay", async () => {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [seller, 10n],
  });
  const trailing: Hex = `${data}00`;
  const variants: Parameters<typeof fixture>[0][] = [
    { chainId: 1 },
    { target: other },
    { value: 1n },
    { data: "0x" },
    { data: trailing },
  ];
  for (const overrides of variants) {
    const f = await fixture(overrides);
    await expect(verifyHeist(f.evidence, f.io)).rejects.toThrow();
    expect(f.replays()).toBe(0);
  }
});

test("a signature from another address is rejected before observation or replay", async () => {
  const f = await fixture();
  f.evidence.lot.address = other;
  f.io.observe = async () => {
    throw new Error("must not query");
  };
  await expect(verifyHeist(f.evidence, f.io)).rejects.toThrow(
    "signature is not from the lot",
  );
  expect(f.replays()).toBe(0);
});

const mutations: [string, (o: Observation, e: HeistEvidence) => void][] = [
  [
    "unconsumed NEAR nonce",
    (o) => {
      o.lot.nextNonce = 1;
    },
  ],
  [
    "unconsumed Base nonce",
    (o) => {
      o.nonce = 1;
    },
  ],
  [
    "wrong derived address",
    (o) => {
      o.derivedAddress = other;
    },
  ],
  [
    "different deployed code",
    (o) => {
      o.codeHash = "changed";
    },
  ],
  [
    "unsafe consuming block",
    (o) => {
      o.safeHead = 49n;
    },
  ],
  [
    "noncanonical burn",
    (o) => {
      o.consumer.canonical = false;
    },
  ],
  [
    "reverted burn",
    (o) => {
      o.consumer.success = false;
    },
  ],
  [
    "different consuming nonce",
    (o) => {
      o.consumer.nonce = 0;
    },
  ],
  [
    "wrong MPC consuming hash",
    (o) => {
      o.proof.calls[1]!.args = {
        request: {
          request: { Base: { tx_id: "different", finality: "Latest" } },
          domain_id: 3,
        },
      };
    },
  ],
  [
    "failed proof callback",
    (o) => {
      o.proof.calls[2]!.value = "false";
    },
  ],
  [
    "different sold lot",
    (o) => {
      o.sale.calls[0]!.args.id = 99;
    },
  ],
  [
    "missing sale event",
    (o) => {
      o.sale.logs = [];
    },
  ],
  [
    "reverted withdrawal",
    (o) => {
      o.withdrawal.success = false;
    },
  ],
  [
    "missing token payment",
    (o) => {
      o.withdrawal.transfers = [];
    },
  ],
  [
    "withdrawal before sale",
    (o) => {
      o.withdrawal.timestamp = 25n;
    },
  ],
];
for (const [name, mutate] of mutations)
  test(`${name} blocks replay`, async () => {
    const f = await fixture();
    mutate(f.observation, f.evidence);
    await expect(verifyHeist(f.evidence, f.io)).rejects.toThrow();
    expect(f.replays()).toBe(0);
  });

test("unavailable mandatory history skips replay", async () => {
  const f = await fixture();
  f.io.observe = async () => {
    throw new Error("NEAR proof history incomplete");
  };
  await expect(verifyHeist(f.evidence, f.io)).rejects.toThrow("incomplete");
  expect(f.replays()).toBe(0);
});

test("transport errors, already-known responses, and accepted broadcasts cannot pass", async () => {
  for (const message of [
    "network timeout",
    "already known",
    "insufficient funds",
    "RPC accepted transaction 0x123",
  ]) {
    const f = await fixture();
    f.io.replay = async () => replayError(new Error(message));
    await expect(verifyHeist(f.evidence, f.io)).rejects.toThrow(
      "Replay failed",
    );
  }
  expect(
    replayError(new Error("nonce too low: next nonce 3, tx nonce 1")).kind,
  ).toBe("nonce-consumed");
});
