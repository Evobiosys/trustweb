// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Keyring-compatible VRC export/import over the REST surface. Import goes through the existing D18 consent gate (I4):
// a verified VRC only ever opens a pending connect card; no edge exists until the owner accepts.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createIdentity, issueVrc } from "@resource-web/transport";
import { createRelationshipKey, exportVrcDi, importVrcDi } from "@resource-web/transport/vrc_di";
import { FakeClock, FakeScheduler } from "../clock.js";
import { InMemoryBus, InMemoryTransport } from "../transport/in_memory_transport.js";
import { SqliteStore } from "../store/sqlite_store.js";
import { Daemon, type DaemonConfig } from "../daemon/daemon.js";
import type { ChatClient, EmbedClient } from "../matcher/clients.js";
import { startServer, type StartedServer } from "./server.js";
import { createVrcDiService, FileRelationshipKeyStore, MemoryRelationshipKeyStore } from "./vrc_di_service.js";

class FakeEmbedClient implements EmbedClient {
  async embed(_model: string, input: string[]): Promise<number[][]> {
    return input.map(() => [1, 0]);
  }
}
class FakeChatClient implements ChatClient {
  async chat(): Promise<string> {
    throw new Error("no LLM in this test");
  }
}

const PEER_KEY = createRelationshipKey(); // an edge whose peer id already is a did:peer:0

async function boot(port: number, withService = true, opts: { authToken?: string; serviceNow?: string } = {}) {
  const clock = new FakeClock("2026-01-01T00:00:00.000Z");
  const store = new SqliteStore(":memory:");
  const config: DaemonConfig = {
    personaName: "Anna",
    peerId: "@anna-agent:wot.local",
    accent: "warm",
    statusDelayMs: 2000,
    defaultAskTtlMs: 3_600_000,
    matcher: { embedModel: "fake", chatModel: "fake", threshold: 0.6 },
  };
  const daemon = new Daemon({ config, store, transport: new InMemoryTransport(new InMemoryBus()), scheduler: new FakeScheduler(clock), clock, embedClient: new FakeEmbedClient(), chatClient: new FakeChatClient() });
  await daemon.init();
  const keys = new MemoryRelationshipKeyStore();
  const server = await startServer(daemon, port, { ...(opts.authToken ? { authToken: opts.authToken } : {}), ...(withService ? { vrcDi: createVrcDiService({ store, keys, now: () => new Date(opts.serviceNow ?? "2026-01-01T00:00:00.000Z") }) } : {}) });
  return { daemon, store, server, keys, base: `http://127.0.0.1:${port}` };
}

/** A valid VRC from `issuer` addressed to a relationship DID this wallet minted. */
const vrcFor = async (b: { keys: MemoryRelationshipKeyStore }, issuer = createRelationshipKey(), subjectDid = b.keys.getOrCreate("me").did) =>
  exportVrcDi(issuer, { subjectDid, validFrom: "2025-12-31T00:00:00Z", validUntil: "2099-01-01T00:00:00Z" });
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
let port = 42100;
const nextPort = () => ++port;

describe("VRC Data Integrity export/import (Keyring interop)", () => {
  let server: StartedServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("GET /api/trust/export?peer= returns a VRC the Data Integrity verifier accepts, signed by a relationship key", async () => {
    const b = await boot(nextPort());
    server = b.server;
    await b.daemon.addTrust({ peer: PEER_KEY.did, display: "Bea" });
    const res = await fetch(`${b.base}/api/trust/export?peer=${encodeURIComponent(PEER_KEY.did)}`);
    expect(res.status).toBe(200);
    const vrc = (await res.json()) as any;
    expect(vrc.proof.cryptosuite).toBe("eddsa-rdfc-2022");
    expect(vrc.credentialSubject.id).toBe(PEER_KEY.did);
    expect(vrc.issuer).toMatch(/^did:peer:0/);
    expect(vrc.issuer).not.toBe(PEER_KEY.did);
    expect(JSON.stringify(vrc)).not.toContain("@anna-agent");
    expect((await importVrcDi(vrc, { now: new Date("2026-06-01T00:00:00Z") })).valid).toBe(true);
    // I9: the credential expires with the edge (+1y)
    expect(vrc.validUntil).toBe("2027-01-01T00:00:00.000Z");
  });

  it("the same edge always exports under the same relationship DID; another edge gets another", async () => {
    const b = await boot(nextPort());
    server = b.server;
    const other = createRelationshipKey();
    await b.daemon.addTrust({ peer: PEER_KEY.did, display: "Bea" });
    await b.daemon.addTrust({ peer: other.did, display: "Cem" });
    const get = async (p: string) => ((await (await fetch(`${b.base}/api/trust/export?peer=${encodeURIComponent(p)}`)).json()) as any).issuer as string;
    const first = await get(PEER_KEY.did);
    expect(await get(PEER_KEY.did)).toBe(first);
    expect(await get(other.did)).not.toBe(first);
  });

  it("404 for a peer without an edge; 400 when the counterparty's relationship DID is unknown or not did:peer:0", async () => {
    const b = await boot(nextPort());
    server = b.server;
    expect((await fetch(`${b.base}/api/trust/export?peer=nobody`)).status).toBe(404);
    const device = createIdentity("https://b.example/didcomm");
    await b.daemon.addTrust({ peer: device.did, display: "Dev" });
    const noSubject = await fetch(`${b.base}/api/trust/export?peer=${encodeURIComponent(device.did)}`);
    expect(noSubject.status).toBe(400);
    expect(((await noSubject.json()) as any).error).toMatch(/subject/);
    const bad = await fetch(`${b.base}/api/trust/export?peer=${encodeURIComponent(device.did)}&subject=${encodeURIComponent(device.did)}`);
    expect(bad.status).toBe(400);
    const ok = await fetch(`${b.base}/api/trust/export?peer=${encodeURIComponent(device.did)}&subject=${encodeURIComponent(PEER_KEY.did)}`);
    expect(ok.status).toBe(200);
    expect(JSON.stringify(await ok.json())).not.toContain(device.did);
  });

  it("legacy GET /api/trust/export?format=vrc still answers 404 without the legacy hook, 400 with neither parameter", async () => {
    const b = await boot(nextPort());
    server = b.server;
    expect((await fetch(`${b.base}/api/trust/export?format=vrc`)).status).toBe(404);
    expect((await fetch(`${b.base}/api/trust/export`)).status).toBe(400);
  });

  it("POST /api/trust/import: a valid VRC opens a pending connect card and forms NO edge until the owner accepts", async () => {
    const b = await boot(nextPort());
    server = b.server;
    const issuer = createRelationshipKey();
    const vrc = await exportVrcDi(issuer, { subjectDid: b.keys.getOrCreate("me").did, validFrom: "2025-12-31T00:00:00Z", validUntil: "2099-01-01T00:00:00Z" });
    const res = await post(`${b.base}/api/trust/import`, { vrc, display: "Keyring Kim" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ valid: true, issuer: issuer.did, state: "pending" });
    expect(b.store.getTrustEdge(issuer.did)).toBeUndefined();
    const card = b.store.getConnect(body.card_id)!;
    expect(card).toMatchObject({ direction: "inbound", peer: issuer.did, display: "Keyring Kim", state: "pending" });

    const accept = await post(`${b.base}/api/connect/accept`, { card_id: body.card_id });
    expect(accept.status).toBe(200);
    expect(b.store.getTrustEdge(issuer.did)?.display).toBe("Keyring Kim");
  });

  it("D7: importing for an existing edge is a 409 and opens no card (no silent update)", async () => {
    const b = await boot(nextPort());
    server = b.server;
    const issuer = createRelationshipKey();
    await b.daemon.addTrust({ peer: issuer.did, display: "Old name", level: "contact" });
    const res = await post(`${b.base}/api/trust/import`, { vrc: await vrcFor(b, issuer), display: "New name" });
    expect(res.status).toBe(409);
    expect(b.store.getConnects()).toHaveLength(0);
    expect(b.store.getTrustEdge(issuer.did)).toMatchObject({ display: "Old name", level: "contact" });
  });

  it("a declined imported card forms no edge and sends nothing", async () => {
    const b = await boot(nextPort());
    server = b.server;
    const vrc = await vrcFor(b);
    const body = (await (await post(`${b.base}/api/trust/import`, { vrc })).json()) as any;
    expect((await post(`${b.base}/api/connect/decline`, { card_id: body.card_id })).status).toBe(200);
    expect(b.store.getConnect(body.card_id)?.state).toBe("declined");
  });

  it("rejects a tampered, an expired and a legacy VRC with 400 and opens no card", async () => {
    const b = await boot(nextPort());
    server = b.server;
    const vrc = await exportVrcDi(createRelationshipKey(), { subjectDid: createRelationshipKey().did, validFrom: "2025-12-31T00:00:00Z", validUntil: "2099-01-01T00:00:00Z" });
    const tampered = JSON.parse(JSON.stringify(vrc));
    tampered.credentialSubject.id = createRelationshipKey().did;
    const expired = await exportVrcDi(createRelationshipKey(), { subjectDid: createRelationshipKey().did, validFrom: "2020-01-01T00:00:00Z", validUntil: "2021-01-01T00:00:00Z" });
    const a = createIdentity("https://a.example/didcomm");
    const legacy = issueVrc(a, { peerDid: createIdentity("https://b.example/didcomm").did, relationship: "trusted" });
    for (const bad of [tampered, expired, legacy, "text", null]) {
      const res = await post(`${b.base}/api/trust/import`, { vrc: bad });
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).error).toBeTruthy();
    }
    expect((await post(`${b.base}/api/trust/import`, {})).status).toBe(400);
    expect(b.store.getConnects()).toHaveLength(0);
  });

  it("both routes answer 404 when the daemon wires no VRC service (mock/matrix transports)", async () => {
    const b = await boot(nextPort(), false);
    server = b.server;
    expect((await fetch(`${b.base}/api/trust/export?peer=x`)).status).toBe(404);
    expect((await post(`${b.base}/api/trust/import`, { vrc: {} })).status).toBe(404);
  });
});

describe("FileRelationshipKeyStore", () => {
  it("keeps one key per edge across restarts, mode 0600", () => {
    const path = join(mkdtempSync(join(tmpdir(), "rk-")), "relationships.json");
    const first = new FileRelationshipKeyStore(path).getOrCreate("peer-a");
    const again = new FileRelationshipKeyStore(path).getOrCreate("peer-a");
    expect(again.did).toBe(first.did);
    expect(new FileRelationshipKeyStore(path).getOrCreate("peer-b").did).not.toBe(first.did);
    expect(JSON.parse(readFileSync(path, "utf8"))["peer-a"]).toBeTruthy();
  });
});

// ---- wave41 review-fixes d ----

const rawPost = (url: string, init: { type?: string; body: string; origin?: string; auth?: string }) =>
  fetch(url, {
    method: "POST",
    headers: { ...(init.type ? { "content-type": init.type } : {}), ...(init.origin ? { origin: init.origin } : {}), ...(init.auth ? { authorization: init.auth } : {}) },
    body: init.body,
  });

describe("D4/D5 import route hardening", () => {
  let server: StartedServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("415 unless Content-Type is application/json (a text/plain simple request opens no card)", async () => {
    const b = await boot(nextPort());
    server = b.server;
    const text = JSON.stringify({ vrc: await vrcFor(b) });
    expect((await rawPost(`${b.base}/api/trust/import`, { type: "text/plain", body: text })).status).toBe(415);
    expect((await rawPost(`${b.base}/api/trust/import`, { body: text })).status).toBe(415);
    expect((await rawPost(`${b.base}/api/trust/import`, { type: "application/json; charset=utf-8", body: text })).status).toBe(200);
    expect(b.store.getConnects()).toHaveLength(1);
  });

  it("403 for a foreign Origin on import and export when no auth token is set; the daemon's own origin passes", async () => {
    const b = await boot(nextPort());
    server = b.server;
    const text = JSON.stringify({ vrc: await vrcFor(b) });
    const evil = await rawPost(`${b.base}/api/trust/import`, { type: "application/json", body: text, origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    expect(b.store.getConnects()).toHaveLength(0);
    await b.daemon.addTrust({ peer: PEER_KEY.did, display: "Bea" });
    const exp = `${b.base}/api/trust/export?peer=${encodeURIComponent(PEER_KEY.did)}`;
    expect((await fetch(exp, { headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await fetch(exp, { headers: { origin: "http://localhost:6666" } })).status).toBe(403);
    expect((await fetch(exp, { headers: { origin: b.base } })).status).toBe(200);
    expect((await rawPost(`${b.base}/api/trust/import`, { type: "application/json", body: text, origin: b.base })).status).toBe(200);
  });

  it("with an auth token the token is the gate: a foreign Origin plus the token passes, no token is 401", async () => {
    const b = await boot(nextPort(), true, { authToken: "tok" });
    server = b.server;
    const text = JSON.stringify({ vrc: await vrcFor(b) });
    expect((await rawPost(`${b.base}/api/trust/import`, { type: "application/json", body: text, origin: "https://app.example" })).status).toBe(401);
    expect((await rawPost(`${b.base}/api/trust/import`, { type: "application/json", body: text, origin: "https://app.example", auth: "Bearer tok" })).status).toBe(200);
  });

  it("429 once 50 VRC cards are pending", async () => {
    const b = await boot(nextPort());
    server = b.server;
    for (let i = 0; i < 50; i++) b.daemon.offerVrcConnect(createRelationshipKey().did, `k${i}`);
    const res = await post(`${b.base}/api/trust/import`, { vrc: await vrcFor(b) });
    expect(res.status).toBe(429);
    expect(b.store.getConnects()).toHaveLength(50);
  });

  it("413 for a body over 64 KB", async () => {
    const b = await boot(nextPort());
    server = b.server;
    const res = await rawPost(`${b.base}/api/trust/import`, { type: "application/json", body: JSON.stringify({ vrc: {}, display: "x".repeat(70_000) }) });
    expect(res.status).toBe(413);
  });

  it("a VRC listing more than 4 contexts is a 400", async () => {
    const b = await boot(nextPort());
    server = b.server;
    const vrc: any = JSON.parse(JSON.stringify(await vrcFor(b)));
    vrc["@context"].push("a", "b", "c");
    expect((await post(`${b.base}/api/trust/import`, { vrc })).status).toBe(400);
  });

  it("display is capped at 80 characters and stripped of control characters", async () => {
    const b = await boot(nextPort());
    server = b.server;
    const body = (await (await post(`${b.base}/api/trust/import`, { vrc: await vrcFor(b), display: `Kim\u0000\u001b[31m${"y".repeat(200)}\n` })).json()) as any;
    const shown = b.store.getConnect(body.card_id)!.display;
    expect(shown.length).toBeLessThanOrEqual(80);
    expect(shown).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(shown.startsWith("Kim[31m")).toBe(true);
  });
});

describe("D6/D7 who a VRC may address, replays, levels", () => {
  let server: StartedServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("D6: a subject that is not one of our relationship DIDs is a 400 and opens no card", async () => {
    const b = await boot(nextPort());
    server = b.server;
    b.keys.getOrCreate("me");
    const res = await post(`${b.base}/api/trust/import`, { vrc: await vrcFor(b, createRelationshipKey(), createRelationshipKey().did) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe("credential not addressed to this wallet");
    expect(b.store.getConnects()).toHaveLength(0);
  });

  it("D6: a VRC issued by one of our own relationship keys is refused", async () => {
    const b = await boot(nextPort());
    server = b.server;
    const mine = b.keys.getOrCreate("me");
    const other = b.keys.getOrCreate("you");
    const res = await post(`${b.base}/api/trust/import`, { vrc: await vrcFor(b, mine, other.did) });
    expect(res.status).toBe(400);
    expect(b.store.getConnects()).toHaveLength(0);
  });

  it("D7: the same credential twice is a 409 the second time", async () => {
    const b = await boot(nextPort());
    server = b.server;
    const vrc = await vrcFor(b);
    expect((await post(`${b.base}/api/trust/import`, { vrc })).status).toBe(200);
    expect((await post(`${b.base}/api/trust/import`, { vrc })).status).toBe(409);
    expect(b.store.getConnects()).toHaveLength(1);
  });

  it("D7: an issuer the owner declined within 30 days gets a 409 for a fresh credential", async () => {
    const b = await boot(nextPort());
    server = b.server;
    const issuer = createRelationshipKey();
    const first = (await (await post(`${b.base}/api/trust/import`, { vrc: await vrcFor(b, issuer) })).json()) as any;
    await post(`${b.base}/api/connect/decline`, { card_id: first.card_id });
    const again = await post(`${b.base}/api/trust/import`, { vrc: await exportVrcDi(issuer, { subjectDid: b.keys.getOrCreate("me").did, validFrom: "2025-12-31T01:00:00Z", validUntil: "2099-01-01T00:00:00Z" }) });
    expect(again.status).toBe(409);
    expect(b.store.getConnects()).toHaveLength(1);
  });

  it("D7: the card asks for level contact (I9) and accept forms a contact edge", async () => {
    const b = await boot(nextPort());
    server = b.server;
    const issuer = createRelationshipKey();
    const body = (await (await post(`${b.base}/api/trust/import`, { vrc: await vrcFor(b, issuer) })).json()) as any;
    expect(b.store.getConnect(body.card_id)?.requested_level).toBe("contact");
    await post(`${b.base}/api/connect/accept`, { card_id: body.card_id });
    expect(b.store.getTrustEdge(issuer.did)?.level).toBe("contact");
  });
});

describe("D10/D12 audit trail and expired edges", () => {
  let server: StartedServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("logs key minting, export and a refused import (I6), never a secret", async () => {
    const b = await boot(nextPort());
    server = b.server;
    await b.daemon.addTrust({ peer: PEER_KEY.did, display: "Bea" });
    await fetch(`${b.base}/api/trust/export?peer=${encodeURIComponent(PEER_KEY.did)}`);
    await post(`${b.base}/api/trust/import`, { vrc: { nope: true } });
    const text = b.store.getAudit().map((a) => `${a.action} ${a.detail}`).join("\n");
    expect(text).toMatch(/relationship key minted for .*did:peer:0/);
    expect(text).toMatch(/VRC exported for .* to did:peer:0/);
    expect(text).toMatch(/VRC import refused: /);
    const key = b.keys.getOrCreate(PEER_KEY.did);
    expect(text).not.toContain(Buffer.from(key.secretKey).toString("base64url"));
    expect(text).not.toContain(Buffer.from(key.secretKey).toString("hex"));
  });

  it("D12: exporting an expired edge is a 400 'edge expired'", async () => {
    const b = await boot(nextPort(), true, { serviceNow: "2028-01-01T00:00:00.000Z" }); // edge expires 2027-01-01
    server = b.server;
    await b.daemon.addTrust({ peer: PEER_KEY.did, display: "Bea" });
    const res = await fetch(`${b.base}/api/trust/export?peer=${encodeURIComponent(PEER_KEY.did)}`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe("edge expired");
  });
});

describe("D8/D9 FileRelationshipKeyStore durability", () => {
  const dirOf = () => join(mkdtempSync(join(tmpdir(), "rk-")), "state");
  it("writes atomically: no tmp files left, file 0600, directory 0700", () => {
    const dir = dirOf();
    const path = join(dir, "relationships.json");
    new FileRelationshipKeyStore(path).getOrCreate("a");
    expect(readdirSync(dir)).toEqual(["relationships.json"]);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });
  it("tightens a wider existing file to 0600 at load", () => {
    const dir = dirOf();
    const path = join(dir, "relationships.json");
    new FileRelationshipKeyStore(path).getOrCreate("a");
    chmodSync(path, 0o644);
    new FileRelationshipKeyStore(path);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
  it("a crash-truncated file is quarantined, the store boots empty and the notice is kept", () => {
    const dir = dirOf();
    const path = join(dir, "relationships.json");
    const good = new FileRelationshipKeyStore(path);
    good.getOrCreate("a");
    const text = readFileSync(path, "utf8");
    writeFileSync(path, text.slice(0, text.length - 20));
    const store = new FileRelationshipKeyStore(path);
    expect(store.all()).toEqual([]);
    const quarantined = readdirSync(dir).filter((f) => f.startsWith("relationships.json.corrupt-"));
    expect(quarantined).toHaveLength(1);
    expect(readFileSync(join(dir, quarantined[0]), "utf8")).toBe(text.slice(0, text.length - 20));
    expect(store.takeNotices().join(" ")).toMatch(/quarantined/);
    expect(store.takeNotices()).toEqual([]);
    expect(store.getOrCreate("b").did).toMatch(/^did:peer:0/);
  });
  it("one unreadable entry does not cost the others; the original is kept as a copy", () => {
    const dir = dirOf();
    const path = join(dir, "relationships.json");
    const first = new FileRelationshipKeyStore(path);
    const keep = first.getOrCreate("a");
    const raw = JSON.parse(readFileSync(path, "utf8"));
    raw.broken = "{not json";
    writeFileSync(path, JSON.stringify(raw));
    const store = new FileRelationshipKeyStore(path);
    expect(store.getOrCreate("a").did).toBe(keep.did);
    expect(readdirSync(dir).some((f) => f.startsWith("relationships.json.corrupt-"))).toBe(true);
  });
  it("two instances on one path never drop each other's keys; open() shares one instance per path", () => {
    const dir = dirOf();
    const path = join(dir, "relationships.json");
    const x = new FileRelationshipKeyStore(path);
    const y = new FileRelationshipKeyStore(path);
    const kx = x.getOrCreate("a");
    const ky = y.getOrCreate("b");
    expect(y.getOrCreate("a").did).toBe(kx.did);
    const onDisk = JSON.parse(readFileSync(path, "utf8"));
    expect(Object.keys(onDisk).sort()).toEqual(["a", "b"]);
    expect(new FileRelationshipKeyStore(path).getOrCreate("b").did).toBe(ky.did);
    expect(FileRelationshipKeyStore.open(path)).toBe(FileRelationshipKeyStore.open(path));
  });
});
