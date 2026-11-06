import { logger } from "./logger.ts";
import { fetchLotAddress } from "@quitclaim/shared";

const [lotContract, path] = Bun.argv.slice(2);
if (!lotContract || !path) {
  logger.error("usage: bun run lot-address <lot-contract-account> <path>");
  process.exit(1);
}
console.log(await fetchLotAddress(lotContract, path));
