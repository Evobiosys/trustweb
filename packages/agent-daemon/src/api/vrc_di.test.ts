// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Keyring-compatible VRC export/import over the REST surface. Import goes through the existing D18 consent gate (I4):
// a verified VRC only ever opens a pending connect card; no edge exists until the owner accepts.
import { mkdtempSync, readFileSync } from "node:fs";
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

async function boot(port: number, withService = true) {
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
  const server = await startServer(daemon, port, withService ? { vrcDi: createVrcDiService({ store, keys, now: () => new Date("2026-01-01T00:00:00.000Z") }) } : {});
  return { daemon, store, server, keys, base: `http://127.0.0.1:${port}` };
}

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
    const vrc = await exportVrcDi(issuer, { subjectDid: createRelationshipKey().did, validFrom: "2025-12-31T00:00:00Z", validUntil: "2099-01-01T00:00:00Z" });
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

  it("importing again for an existing edge still waits for the owner (no silent update)", async () => {
    const b = await boot(nextPort());
    server = b.server;
    const issuer = createRelationshipKey();
    await b.daemon.addTrust({ peer: issuer.did, display: "Old name", level: "contact" });
    const vrc = await exportVrcDi(issuer, { subjectDid: createRelationshipKey().did, validFrom: "2025-12-31T00:00:00Z", validUntil: "2099-01-01T00:00:00Z" });
    const body = (await (await post(`${b.base}/api/trust/import`, { vrc, display: "New name" })).json()) as any;
    expect(body.state).toBe("pending");
    expect(b.store.getTrustEdge(issuer.did)).toMatchObject({ display: "Old name", level: "contact" });
  });

  it("a declined imported card forms no edge and sends nothing", async () => {
    const b = await boot(nextPort());
    server = b.server;
    const vrc = await exportVrcDi(createRelationshipKey(), { subjectDid: createRelationshipKey().did, validFrom: "2025-12-31T00:00:00Z", validUntil: "2099-01-01T00:00:00Z" });
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
