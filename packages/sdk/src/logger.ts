import pino from "pino";
import pretty from "pino-pretty";

/** Diagnostics go to stderr so CLI results on stdout stay pipeable. */
export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
    base: undefined,
    redact: ["private_key", "privateKey", "secretKey", "key", "credentials"],
  },
  process.stderr.isTTY
    ? pretty({ destination: 2, sync: true, colorize: true })
    : pino.destination({ dest: 2, sync: true }),
);
