import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { generateKeyPair, seal } from "./sealed_box.js";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const cliPath = join(here, "cli_unseal.ts");
// Resolve tsx the same way the package's own scripts do, without relying on
// $PATH: from the workspace root's node_modules/.bin.
const tsxBin = join(here, "..", "..", "..", "node_modules", ".bin", "tsx");

async function runCli(args: string[], stdin: string, env: Record<string, string> = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      tsxBin,
      [cliPath, ...args],
      { encoding: "utf8", env: { ...process.env, ...env } },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
          e.stdout = stdout;
          e.stderr = stderr;
          reject(e);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
    child.stdin?.write(stdin);
    child.stdin?.end();
  });
}

describe("cli_unseal", () => {
  it("decrypts an envelope piped on stdin via --key", async () => {
    const { publicJwk, privatePkcs8Base64 } = await generateKeyPair();
    const plaintext = JSON.stringify({ name: "Ada", text: "cli round trip" });
    const envelope = await seal(publicJwk, new TextEncoder().encode(plaintext));
    const { stdout } = await runCli(["--key", privatePkcs8Base64], JSON.stringify(envelope));
    expect(stdout).toBe(plaintext);
  }, 20_000);

  it("decrypts using --key-env", async () => {
    const { publicJwk, privatePkcs8Base64 } = await generateKeyPair();
    const plaintext = "via env var";
    const envelope = await seal(publicJwk, new TextEncoder().encode(plaintext));
    const { stdout } = await runCli(["--key-env", "RELAY_PRIVATE_KEY"], JSON.stringify(envelope), {
      RELAY_PRIVATE_KEY: privatePkcs8Base64,
    });
    expect(stdout).toBe(plaintext);
  }, 20_000);

  it("exits non-zero on a wrong key instead of printing garbage", async () => {
    const a = await generateKeyPair();
    const b = await generateKeyPair();
    const envelope = await seal(a.publicJwk, new TextEncoder().encode("secret"));
    await expect(runCli(["--key", b.privatePkcs8Base64], JSON.stringify(envelope))).rejects.toMatchObject({
      code: 1,
    });
  }, 20_000);

  it("exits non-zero on malformed stdin", async () => {
    const { privatePkcs8Base64 } = await generateKeyPair();
    await expect(runCli(["--key", privatePkcs8Base64], "not json")).rejects.toMatchObject({ code: 1 });
  }, 20_000);
});
