import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { isHash, type Address } from "viem";
import { createStream } from "./sablier.ts";

/** A durable claim precedes funding. An interrupted attempt is held for recovery, never paid twice. */
export async function demoStreamOnce(contract: string, address: Address) {
  const root = join(process.cwd(), ".quitclaim", "demo-streams");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(
    root,
    createHash("sha256")
      .update(`${contract}:${address.toLowerCase()}`)
      .digest("hex"),
  );
  try {
    await writeFile(
      path,
      JSON.stringify({ state: "pending", contract, address }),
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "EEXIST"
    )
      throw error;
    const prior = z
      .object({ tx: z.string().refine(isHash).optional() })
      .parse(JSON.parse(await readFile(path, "utf8")));
    if (!prior.tx || !isHash(prior.tx))
      throw new Error(
        "The example stream was already requested. Funding is pending or needs recovery; do not create another. Check the server's .quitclaim/demo-streams record.",
      );
    return prior.tx;
  }
  const { tx } = await createStream(address, 5n * 10n ** 6n, 86_400);
  await writeFile(
    path,
    JSON.stringify({ state: "funded", contract, address, tx }),
    { mode: 0o600 },
  );
  return tx;
}
