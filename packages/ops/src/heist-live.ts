import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = await mkdtemp(join(tmpdir(), "quitclaim-judge-"));
try {
  const child = Bun.spawn(
    [
      process.execPath,
      "--no-env-file",
      new URL("./heist.ts", import.meta.url).pathname,
    ],
    {
      cwd: home,
      env: { HOME: home, PATH: process.env.PATH ?? "" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const timer = setTimeout(() => child.kill(), 60_000);
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    process.stdout.write(stdout);
    process.stderr.write(stderr);
    if (
      code !== 0 ||
      !stdout.includes("PASS Alice's retained withdrawal was rejected.")
    )
      throw new Error("credential-free live heist did not pass");
    console.log(
      "PASS live command with an empty home, empty working directory, and no dotenv or credential environment.",
    );
  } finally {
    clearTimeout(timer);
  }
} finally {
  await rm(home, { recursive: true, force: true });
}
