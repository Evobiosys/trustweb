import { describe, expect, it } from "vitest";
import { peerKey, resolveContactOptions, resolveContactOptionsFor } from "./contact_channels.js";
import type { PeerContactRecord } from "./contact_channels.js";

const map: PeerContactRecord[] = [
  { requester: "anna@example.org", preferred_channel: "matrix", matrix: "@anna:matrix.myceli.al" },
  { requester: "Ben Okafor <ben@example.org>", preferred_channel: "signal", signal: "+43 660 1234567" },
  { requester: "Cyn Park <cyn@example.org>", matrix: "@cynpark:matrix.myceli.al", signal: "+1 415 555 0134" },
];

describe("peerKey", () => {
  it("pulls the email out of a Name <email> requester string", () => {
    expect(peerKey("Ben Okafor <ben@example.org>")).toBe("ben@example.org");
  });

  it("lowercases and trims a bare requester string", () => {
    expect(peerKey("  Anna@Example.ORG  ")).toBe("anna@example.org");
  });

  it("falls back to the whole string when there's no angle-bracket email", () => {
    expect(peerKey("some-opaque-id")).toBe("some-opaque-id");
  });
});

describe("resolveContactOptions", () => {
  it("always returns the Web-of-Trust primary, even for an unknown requester", () => {
    const options = resolveContactOptions(map, "nobody-on-file@example.org");
    expect(options.primary).toEqual({ channel: "wot", label: "Contact over Web of Trust" });
    expect(options.fallbacks).toEqual([]);
  });

  it("resolves a bare-email requester against a bare-email record", () => {
    const options = resolveContactOptions(map, "anna@example.org");
    expect(options.fallbacks).toHaveLength(1);
    expect(options.fallbacks[0]).toMatchObject({ channel: "matrix", preferred: true });
    expect(options.fallbacks[0]!.href).toBe("https://matrix.to/#/%40anna%3Amatrix.myceli.al");
  });

  it("resolves a Name <email> requester against a Name <email> record", () => {
    const options = resolveContactOptions(map, "Ben Okafor <ben@example.org>");
    expect(options.fallbacks[0]).toMatchObject({ channel: "signal", preferred: true });
  });

  it("matches across formats: bare-email lookup against a Name <email> record", () => {
    const options = resolveContactOptions(map, "ben@example.org");
    expect(options.fallbacks[0]?.channel).toBe("signal");
  });

  it("orders fallbacks by preferred_channel when both are known", () => {
    const withPreference: PeerContactRecord[] = [
      { requester: "cyn@example.org", preferred_channel: "signal", matrix: "@c:matrix.myceli.al", signal: "+1 415 555 0134" },
    ];
    const options = resolveContactOptions(withPreference, "cyn@example.org");
    expect(options.fallbacks.map((f) => f.channel)).toEqual(["signal", "matrix"]);
  });

  it("keeps a fixed order (matrix then signal) when no preference is recorded", () => {
    const options = resolveContactOptions(map, "cyn@example.org");
    expect(options.fallbacks.map((f) => f.channel)).toEqual(["matrix", "signal"]);
    expect(options.fallbacks.every((f) => !f.preferred)).toBe(true);
  });

  it("renders a bare phone number into a signal.me link", () => {
    const options = resolveContactOptions(map, "ben@example.org");
    expect(options.fallbacks[0]!.href).toBe("https://signal.me/#p/%2B436601234567");
  });
});

describe("resolveContactOptionsFor", () => {
  it("resolves every distinct requester exactly once", () => {
    const out = resolveContactOptionsFor(map, ["anna@example.org", "anna@example.org", "ben@example.org"]);
    expect(Object.keys(out)).toEqual(["anna@example.org", "ben@example.org"]);
    expect(out["anna@example.org"]!.fallbacks[0]!.channel).toBe("matrix");
  });
});
