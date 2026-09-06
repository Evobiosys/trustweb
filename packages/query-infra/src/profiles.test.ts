import { describe, expect, it } from "vitest";
import { ProfileError, ProfileNotFoundError, parseProfilesJson, parseProfilesJsonl, profileById } from "./profiles.js";

describe("parseProfilesJsonl", () => {
  it("parses one JSON object per line, skipping blank lines", () => {
    const raw = [
      '{"id":"general","name":"Jakob","contact":"connect@evobiosys.org"}',
      "",
      '{"id":"housing-host","name":"J. (housing)","contact":"housing@evobiosys.org","blurb":"example"}',
      "",
    ].join("\n");
    const profiles = parseProfilesJsonl(raw);
    expect(profiles).toHaveLength(2);
    expect(profiles[0]).toEqual({ id: "general", name: "Jakob", contact: "connect@evobiosys.org" });
    expect(profiles[1]).toMatchObject({ id: "housing-host", blurb: "example" });
  });

  it("throws ProfileError naming the line on malformed JSON", () => {
    const raw = '{"id":"general","name":"Jakob","contact":"x"}\nnot json\n';
    expect(() => parseProfilesJsonl(raw)).toThrow(ProfileError);
    expect(() => parseProfilesJsonl(raw)).toThrow(/line 2/);
  });

  it("throws on a profile missing a required field", () => {
    expect(() => parseProfilesJsonl('{"id":"x","name":"Only"}')).toThrow(ProfileError);
    expect(() => parseProfilesJsonl('{"name":"No id","contact":"x"}')).toThrow(ProfileError);
  });

  it("throws on a non-string blurb", () => {
    expect(() => parseProfilesJsonl('{"id":"x","name":"X","contact":"y","blurb":5}')).toThrow(ProfileError);
  });
});

describe("parseProfilesJson (legacy array fallback)", () => {
  it("parses the pre-migration single-array shape", () => {
    const raw = JSON.stringify([{ id: "general", name: "Jakob", contact: "connect@evobiosys.org" }]);
    expect(parseProfilesJson(raw)).toEqual([{ id: "general", name: "Jakob", contact: "connect@evobiosys.org" }]);
  });

  it("throws if the top level is not an array", () => {
    expect(() => parseProfilesJson('{"id":"general"}')).toThrow(ProfileError);
  });
});

describe("profileById", () => {
  const profiles = [
    { id: "general", name: "Jakob", contact: "connect@evobiosys.org" },
    { id: "housing-host", name: "J. (housing)", contact: "housing@evobiosys.org" },
  ];

  it("defaults to \"general\" when no id is given", () => {
    expect(profileById(profiles)).toEqual(profiles[0]);
  });

  it("resolves a named custom profile by id", () => {
    expect(profileById(profiles, "housing-host")).toEqual(profiles[1]);
  });

  it("throws ProfileNotFoundError on an unknown explicit id — never a silent fallback", () => {
    expect(() => profileById(profiles, "does-not-exist")).toThrow(ProfileNotFoundError);
    // the explicit failure must not return any profile, including "general"
    try {
      profileById(profiles, "does-not-exist");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ProfileNotFoundError);
    }
  });

  it("throws if the implicit \"general\" default is itself missing", () => {
    const noGeneral = [{ id: "housing-host", name: "J.", contact: "x" }];
    expect(() => profileById(noGeneral)).toThrow(ProfileNotFoundError);
  });
});
