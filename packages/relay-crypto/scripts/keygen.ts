#!/usr/bin/env tsx
// Generates the laptop's long-lived E2EE keypair for the rebiosys relay.
// Does NOT touch the keychain — prints the public JWK (safe to embed in the
// landing form / seal.js) and the exact `security add-generic-password`
// command for the user to run themselves to store the private key.
//
// Usage: pnpm --filter @resource-web/relay-crypto keygen

import { generateKeyPair } from "../src/sealed_box.js";

async function main(): Promise<void> {
  const { publicJwk, privatePkcs8Base64 } = await generateKeyPair();

  console.log("… rebiosys-relay-crypto keygen running …");
  console.log("--------");
  console.log("Public JWK (embed in the landing page / seal.js, safe to publish):");
  console.log(JSON.stringify(publicJwk));
  console.log("--------");
  console.log("Private key: NOT stored anywhere by this script. Store it yourself with:");
  console.log("");
  console.log(
    `security add-generic-password -U -s rebiosys-e2ee -a laptop -w '${privatePkcs8Base64}'`,
  );
  console.log("");
  console.log("-------- keygen done. Run the command above yourself; this script never touches the keychain.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
