// seal.js — dependency-free browser E2EE for the rebiosys landing form.
// No bundler, no imports: load as a plain classic <script src="/seal.js">
// and call sealForLaptop(publicJwk, obj) before POSTing to the relay.
//
// Wire format matches packages/relay-crypto/src/sealed_box.ts exactly:
// ECDH-ES (P-256) ephemeral keypair -> HKDF-SHA-256 -> AES-256-GCM. The
// relay only ever sees { ciphertext_envelope: <envelope> } — it cannot read
// the query text. Each message uses a fresh ephemeral sender keypair, so
// compromising one envelope's ephemeral key does not expose any other
// message. The laptop's long-lived private key still decrypts every
// envelope ever sent to it, by design — that is how the laptop reads its
// mail; this scheme protects the relay/network path, not the endpoint.
//
// Usage in the landing form:
//   <script src="/seal.js"></script>
//   <script>
//     const LAPTOP_PUBLIC_JWK = { /* printed by `pnpm keygen`, embed here */ };
//     async function onSubmit(formData) {
//       const envelope = await sealForLaptop(LAPTOP_PUBLIC_JWK, {
//         name: formData.get("name"),
//         email: formData.get("email"),
//         text: formData.get("text"),
//       });
//       await fetch("/submit", {
//         method: "POST",
//         headers: { "content-type": "application/json" },
//         body: JSON.stringify({ ciphertext_envelope: envelope }),
//       });
//     }
//   </script>

const HKDF_INFO = "rebiosys-relay-e2ee-v1";
const IV_BYTES = 12;
const ALG = "ECDH-ES+A256GCM";

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Encrypts a plain JS object to the laptop's public key. Returns an
 * envelope object ready to JSON.stringify and POST as-is — never send the
 * original `obj` anywhere, only the returned envelope.
 *
 * @param {JsonWebKey} publicJwk - the laptop's long-lived public key (P-256 JWK)
 * @param {object} obj - the plaintext payload, e.g. { name, email, text }
 * @returns {Promise<{v:1, alg:string, epk:JsonWebKey, iv:string, ct:string}>}
 */
async function sealForLaptop(publicJwk, obj) {
  const subtle = crypto.subtle;
  const recipientKey = await subtle.importKey(
    "jwk",
    publicJwk,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    [],
  );
  const ephemeral = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const sharedBits = await subtle.deriveBits({ name: "ECDH", public: recipientKey }, ephemeral.privateKey, 256);
  const hkdfKey = await subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]);
  const aesKey = await subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode(HKDF_INFO) },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(obj));
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, aesKey, plaintext);
  const epk = await subtle.exportKey("jwk", ephemeral.publicKey);
  return {
    v: 1,
    alg: ALG,
    epk,
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(ct)),
  };
}

// Classic script (no `export`, so it also parses fine if a bundler ever
// pulls it in as a plain asset) — attach to globalThis for both window
// (browser) and other global contexts.
globalThis.sealForLaptop = sealForLaptop;
