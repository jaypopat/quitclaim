/**
 * Minting without a trusted admin: a front-runner can't take a title over someone else's stream,
 * a cancelable stream is refused, and Alice mints a stream created by the separate EVM funder.
 */
import { config, fetchLotAddress } from "@quitclaim/shared";
import * as base from "../base.ts";
import { MINT_DEPOSIT } from "../lot.ts";
import { call, getFinality } from "../near.ts";
import * as sablier from "../sablier.ts";
import { alice, bob, contract, lotOf } from "./context.ts";
import type { Run } from "./report.ts";

export async function minting(run: Run) {
  const name = `e2e-minting-${run.started.getTime()}`;
  const address = await fetchLotAddress(contract, `${alice}/${name}`);
  const stream = await sablier.createStream(address, 2n * 10n ** 6n, 3_600);
  run.record(
    "alice creates a stream to her lot address",
    "non-cancelable, non-transferable, paying alice's namespaced lot address",
    `stream ${stream.id} pays ${address}`,
    (await sablier.titleSearch(stream.id, address, config.evm.token)).clean,
    [`stream ${base.txUrl(stream.tx)}`],
  );
  await base.waitFinality(stream.block, await getFinality(contract));

  const front = await call(
    bob,
    contract,
    "mint_proven",
    { name, owner_id: bob, royalty_bps: 0, log: stream.log },
    { deposit: MINT_DEPOSIT },
  );
  run.record(
    "bob front-runs the mint with alice's log",
    "rolled back: bob's path derives a different address than the stream pays",
    front.ok ? `returned ${JSON.stringify(front.value)}` : front.error,
    front.ok && front.value === null,
    [front.url],
  );

  const mine = await call(
    alice,
    contract,
    "mint_proven",
    { name, owner_id: alice, royalty_bps: 250, log: stream.log },
    { deposit: MINT_DEPOSIT },
  );
  const lot = mine.ok && mine.value ? await lotOf(mine.value.id) : null;
  run.record(
    "alice mints",
    "MPC attests the creation log; the title binds the stream and token, minter = alice",
    lot
      ? `lot ${mine.ok && mine.value?.id} ${lot.state}, path ${lot.path}, stream ${lot.source?.id}`
      : mine.ok
        ? "rolled back"
        : mine.error,
    !!lot &&
      lot.state === "Active" &&
      lot.path === `${alice}/${name}` &&
      lot.minter === alice &&
      lot.source?.id === stream.id.toString(),
    [mine.url],
  );
  if (mine.ok && mine.value)
    run.lots.push({ id: mine.value.id, address: mine.value.address });

  const otherName = `${name}-cancelable`;
  const otherAddress = await fetchLotAddress(contract, `${alice}/${otherName}`);
  const cancelable = await sablier.createStream(
    otherAddress,
    10n ** 6n,
    3_600,
    { cancelable: true },
  );
  const refused = await call(
    alice,
    contract,
    "mint_proven",
    { name: otherName, owner_id: alice, royalty_bps: 0, log: cancelable.log },
    { deposit: MINT_DEPOSIT },
  );
  run.record(
    "mint against a cancelable stream",
    "refused before any MPC call: the stream sender could take the position back",
    refused.ok ? "minted!" : refused.error,
    !refused.ok && refused.error.includes("stream is cancelable"),
    [`stream ${base.txUrl(cancelable.tx)}`, refused.url],
  );
}
