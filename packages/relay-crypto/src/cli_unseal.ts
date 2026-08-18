#!/usr/bin/env tsx
// Tiny CLI wrapper around unseal(): reads a SealEnvelope as JSON on stdin,
// decrypts it with a PKCS8 private key (base64), writes the UTF-8 plaintext
// to stdout. Exists so a Python caller (rebiosys-pull-e2ee, which has no
// WebCrypto) can shell out to Node for the actual decryption instead of
// reimplementing ECDH/HKDF/AES-GCM.
//
// Usage:
//   echo '<envelope json>' | tsx cli_unseal.ts --key-env RELAY_PRIVATE_KEY
//   echo '<envelope json>' | tsx cli_unseal.ts --key <base64-pkcs8>
//
// Exit 0 + plaintext on stdout on success.
// Exit 1 + short reason on stderr on any failure (bad key, tampered
// ciphertext, malformed envelope) — caller decides what "undecryptable"
// means for its own record-keeping; this CLI never guesses.

import { unseal, type SealEnvelope } from "./sealed_box.js";

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c) => chunks.push(c as Buffer));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function resolveKey(argv: string[]): string {
  const keyIdx = argv.indexOf("--key");
  if (keyIdx !== -1 && argv[keyIdx + 1]) return argv[keyIdx + 1]!;
  const keyEnvIdx = argv.indexOf("--key-env");
  const envName = keyEnvIdx !== -1 && argv[keyEnvIdx + 1] ? argv[keyEnvIdx + 1]! : "RELAY_PRIVATE_KEY";
  const val = process.env[envName];
  if (!val) throw new Error(`no private key: set ${envName} or pass --key <base64-pkcs8>`);
  return val;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const keyBase64 = resolveKey(argv);
  const raw = await readStdin();
  let envelope: SealEnvelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new Error("stdin is not valid JSON");
  }
  const plaintext = await unseal(keyBase64, envelope);
  process.stdout.write(Buffer.from(plaintext));
}

main().catch((err) => {
  process.stderr.write(`cli_unseal: ${(err as Error).message}\n`);
  process.exit(1);
});
