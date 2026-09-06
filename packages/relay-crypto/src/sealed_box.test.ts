import { describe, expect, it } from "vitest";
import { generateKeyPair, importPrivateKey, seal, unseal, type SealEnvelope } from "./sealed_box.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

describe("sealed_box", () => {
  it("round-trips a small plaintext (node, ephemeral keys)", async () => {
    const { publicJwk, privatePkcs8Base64 } = await generateKeyPair();
    const plaintext = enc.encode(JSON.stringify({ name: "Ada", text: "hi" }));
    const envelope = await seal(publicJwk, plaintext);
    const out = await unseal(privatePkcs8Base64, envelope);
    expect(dec.decode(out)).toBe(dec.decode(plaintext));
  });

  it("accepts an already-imported CryptoKey as the private key", async () => {
    const { publicJwk, privatePkcs8Base64 } = await generateKeyPair();
    const key = await importPrivateKey(privatePkcs8Base64);
    const plaintext = enc.encode("cryptokey path");
    const envelope = await seal(publicJwk, plaintext);
    const out = await unseal(key, envelope);
    expect(dec.decode(out)).toBe("cryptokey path");
  });

  it("fails with the wrong private key", async () => {
    const a = await generateKeyPair();
    const b = await generateKeyPair();
    const envelope = await seal(a.publicJwk, enc.encode("secret"));
    await expect(unseal(b.privatePkcs8Base64, envelope)).rejects.toThrow();
  });

  it("fails when the ciphertext is tampered (GCM auth)", async () => {
    const { publicJwk, privatePkcs8Base64 } = await generateKeyPair();
    const envelope = await seal(publicJwk, enc.encode("tamper me"));
    const ctBytes = Buffer.from(envelope.ct, "base64");
    ctBytes[0] = ctBytes[0]! ^ 0xff;
    const tampered: SealEnvelope = { ...envelope, ct: ctBytes.toString("base64") };
    await expect(unseal(privatePkcs8Base64, tampered)).rejects.toThrow();
  });

  it("fails when the iv is tampered (GCM auth)", async () => {
    const { publicJwk, privatePkcs8Base64 } = await generateKeyPair();
    const envelope = await seal(publicJwk, enc.encode("tamper the iv"));
    const ivBytes = Buffer.from(envelope.iv, "base64");
    ivBytes[0] = ivBytes[0]! ^ 0xff;
    const tampered: SealEnvelope = { ...envelope, iv: ivBytes.toString("base64") };
    await expect(unseal(privatePkcs8Base64, tampered)).rejects.toThrow();
  });

  it("fails when the ephemeral public key (epk) is tampered", async () => {
    const { publicJwk, privatePkcs8Base64 } = await generateKeyPair();
    const other = await generateKeyPair();
    const envelope = await seal(publicJwk, enc.encode("tamper the epk"));
    const tampered: SealEnvelope = { ...envelope, epk: other.publicJwk };
    await expect(unseal(privatePkcs8Base64, tampered)).rejects.toThrow();
  });

  it("produces a JSON-serializable envelope with stable field names", async () => {
    const { publicJwk } = await generateKeyPair();
    const envelope = await seal(publicJwk, enc.encode("stability check"));
    const roundTripped = JSON.parse(JSON.stringify(envelope));
    expect(roundTripped).toEqual(envelope);
    expect(Object.keys(envelope).sort()).toEqual(["alg", "ct", "epk", "iv", "v"]);
    expect(envelope.v).toBe(1);
    expect(envelope.alg).toBe("ECDH-ES+A256GCM");
    expect(typeof envelope.iv).toBe("string");
    expect(typeof envelope.ct).toBe("string");
  });

  it("round-trips a large (10 KB) payload", async () => {
    const { publicJwk, privatePkcs8Base64 } = await generateKeyPair();
    const big = "x".repeat(10 * 1024);
    const plaintext = enc.encode(big);
    const envelope = await seal(publicJwk, plaintext);
    const out = await unseal(privatePkcs8Base64, envelope);
    expect(dec.decode(out)).toBe(big);
    expect(out.byteLength).toBe(plaintext.byteLength);
  });

  it("rejects an envelope with an unsupported alg/version", async () => {
    const { publicJwk, privatePkcs8Base64 } = await generateKeyPair();
    const envelope = await seal(publicJwk, enc.encode("x"));
    const badVersion = { ...envelope, v: 2 } as unknown as SealEnvelope;
    await expect(unseal(privatePkcs8Base64, badVersion)).rejects.toThrow(/unsupported envelope/);
    const badAlg = { ...envelope, alg: "AES-ONLY" } as unknown as SealEnvelope;
    await expect(unseal(privatePkcs8Base64, badAlg)).rejects.toThrow(/unsupported envelope/);
  });
});
