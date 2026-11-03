// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { parseSenderAuthEnv } from "./relay_env.js";

describe("parseSenderAuthEnv", () => {
  it("empty env -> optional mode, no audiences, allowV1 left to the server default", () => {
    const parsed = parseSenderAuthEnv({});
    expect(parsed).toEqual({ senderAuth: "optional" });
    expect("senderAuthAudiences" in parsed).toBe(false);
    expect("senderAuthAllowV1" in parsed).toBe(false);
  });

  it("RELAY_SENDER_AUTH goes through parseSenderAuthMode (valid values pass, junk throws)", () => {
    expect(parseSenderAuthEnv({ RELAY_SENDER_AUTH: "required" }).senderAuth).toBe("required");
    expect(parseSenderAuthEnv({ RELAY_SENDER_AUTH: "off" }).senderAuth).toBe("off");
    expect(() => parseSenderAuthEnv({ RELAY_SENDER_AUTH: "yes" })).toThrow(/RELAY_SENDER_AUTH/);
  });

  it("audiences: comma-separated, trimmed, lower-cased, canonical origins", () => {
    const parsed = parseSenderAuthEnv({
      RELAY_SENDER_AUTH_AUDIENCES: " https://Relay.Example , http://127.0.0.1:4177,https://relay.example:443/ ",
    });
    expect(parsed.senderAuthAudiences).toEqual(["https://relay.example", "http://127.0.0.1:4177"]);
  });

  it("audiences: unset or blank -> omitted", () => {
    expect(parseSenderAuthEnv({ RELAY_SENDER_AUTH_AUDIENCES: "" }).senderAuthAudiences).toBeUndefined();
    expect(parseSenderAuthEnv({ RELAY_SENDER_AUTH_AUDIENCES: "   " }).senderAuthAudiences).toBeUndefined();
  });

  it.each([
    "relay.example",
    "https://relay.example/relay/send",
    "https://relay.example/?x=1",
    "https://relay.example/#frag",
    "https://user:pw@relay.example",
    "ftp://relay.example",
    "not a url",
    "https://relay.example,,https://other.example",
    "https://relay.example,",
  ])("audiences: %j throws", (value) => {
    expect(() => parseSenderAuthEnv({ RELAY_SENDER_AUTH_AUDIENCES: value })).toThrow(/RELAY_SENDER_AUTH_AUDIENCES/);
  });

  it("allowV1: true/false parse, unset/blank -> undefined, anything else throws", () => {
    expect(parseSenderAuthEnv({ RELAY_SENDER_AUTH_ALLOW_V1: "true" }).senderAuthAllowV1).toBe(true);
    expect(parseSenderAuthEnv({ RELAY_SENDER_AUTH_ALLOW_V1: "false" }).senderAuthAllowV1).toBe(false);
    expect(parseSenderAuthEnv({ RELAY_SENDER_AUTH_ALLOW_V1: "" }).senderAuthAllowV1).toBeUndefined();
    for (const bad of ["1", "yes", "TRUE", " true"]) {
      expect(() => parseSenderAuthEnv({ RELAY_SENDER_AUTH_ALLOW_V1: bad })).toThrow(/RELAY_SENDER_AUTH_ALLOW_V1/);
    }
  });
});
