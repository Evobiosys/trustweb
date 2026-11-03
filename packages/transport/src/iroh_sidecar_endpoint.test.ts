// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// iroh_sidecar_endpoint.test.ts — IrohSidecarEndpoint (docs/IROH-SIDECAR.md)
// against the fake sidecar in test_support/fake_iroh_sidecar.mjs (Node, UDP on
// loopback) and against scripted in-process children. No real iroh node, no
// network beyond 127.0.0.1, no personal data: synthetic ids and random bytes.
import { describe, it, expect } from "vitest";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { IrohSidecarEndpoint, findIrohSidecar, type IrohSidecarEndpointOptions } from "./iroh_sidecar_endpoint.js";

const FAKE = fileURLToPath(new URL("./test_support/fake_iroh_sidecar.mjs", import.meta.url));

type SpawnFn = NonNullable<IrohSidecarEndpointOptions["spawnImpl"]>;

/** A spawnImpl that runs the fake sidecar under this Node, passing through the CLI args the endpoint built. */
function fakeSpawn(mode?: string, spawned: ChildProcess[] = []): SpawnFn {
  return ((_cmd: string, args: readonly string[], opts: SpawnOptions) => {
    const child = spawn(process.execPath, [FAKE, ...args], {
      ...opts,
      env: { ...process.env, FAKE_SIDECAR_MODE: mode ?? "" },
    });
    spawned.push(child);
    return child;
  }) as unknown as SpawnFn;
}

function fakeEndpoint(opts: Partial<IrohSidecarEndpointOptions> & { mode?: string; spawned?: ChildProcess[] } = {}) {
  const { mode, spawned, ...rest } = opts;
  return new IrohSidecarEndpoint({ binaryPath: "trustweb-iroh-sidecar-fake", spawnImpl: fakeSpawn(mode, spawned), ...rest });
}

/** Collect every payload the endpoint receives; `next()` waits for the next one. */
function collector(ep: IrohSidecarEndpoint) {
  const got: Uint8Array[] = [];
  const waiters: ((p: Uint8Array) => void)[] = [];
  ep.onReceive((p) => {
    const w = waiters.shift();
    if (w) w(p);
    else got.push(p);
  });
  return {
    next(timeoutMs = 5000): Promise<Uint8Array> {
      const queued = got.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("no payload received in time")), timeoutMs);
        waiters.push((p) => {
          clearTimeout(t);
          resolve(p);
        });
      });
    },
  };
}

/** A scripted child process: the test drives stdout and reads what the endpoint wrote to stdin. */
class ScriptedChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  written = "";
  signals: (string | number | undefined)[] = [];
  exitCode: number | null = null;
  signalCode: string | null = null;
  pid = 4242;
  stdin: Writable;
  /** What to do with a signal; default: exit on it. */
  onSignal: (sig: string | number | undefined) => void = (sig) => this.exit(null, String(sig));
  constructor() {
    super();
    this.stdin = new Writable({
      write: (chunk, _enc, cb) => {
        this.written += chunk.toString("utf8");
        cb();
      },
    });
  }
  kill(sig?: string | number): boolean {
    this.signals.push(sig ?? "SIGTERM");
    this.onSignal(sig ?? "SIGTERM");
    return true;
  }
  exit(code: number | null, signal: string | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    this.stdout.end();
    this.stderr.end();
    this.emit("exit", code, signal);
    setImmediate(() => this.emit("close", code, signal));
  }
  linesWritten(): Record<string, unknown>[] {
    return this.written
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  }
}

function scriptedSpawn(child: ScriptedChild, calls: unknown[][] = []): SpawnFn {
  return ((...args: unknown[]) => {
    calls.push(args);
    return child as unknown as ChildProcess;
  }) as unknown as SpawnFn;
}

const tick = () => new Promise((r) => setImmediate(r));
const waitFor = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe("findIrohSidecar", () => {
  const dirA = path.join(path.sep, "opt", "a-bin");
  const dirB = path.join(path.sep, "opt", "b-bin");
  const exe = process.platform === "win32" ? "trustweb-iroh-sidecar.exe" : "trustweb-iroh-sidecar";

  it("prefers TRUSTWEB_IROH_SIDECAR over PATH", () => {
    const envPath = path.join(path.sep, "custom", "sidecar");
    const exists = (p: string) => p === envPath || p === path.join(dirA, exe);
    expect(findIrohSidecar({ TRUSTWEB_IROH_SIDECAR: envPath, PATH: dirA }, exists)).toBe(envPath);
  });

  it("finds the first trustweb-iroh-sidecar on PATH", () => {
    const exists = (p: string) => p === path.join(dirB, exe);
    expect(findIrohSidecar({ PATH: [dirA, dirB].join(path.delimiter) }, exists)).toBe(path.join(dirB, exe));
  });

  it("returns undefined when nothing is found", () => {
    expect(findIrohSidecar({ PATH: [dirA, dirB].join(path.delimiter) }, () => false)).toBeUndefined();
    expect(findIrohSidecar({}, () => true)).toBeUndefined();
  });

  it("does not fall back to PATH when TRUSTWEB_IROH_SIDECAR names a missing file", () => {
    const exists = (p: string) => p === path.join(dirA, exe);
    expect(findIrohSidecar({ TRUSTWEB_IROH_SIDECAR: "/nope/sidecar", PATH: dirA }, exists)).toBeUndefined();
  });
});

describe("IrohSidecarEndpoint (fake sidecar)", () => {
  it("start() completes the ready handshake and exposes nodeId/directAddrs", async () => {
    const ep = fakeEndpoint({ relayUrls: ["https://relay.test.example"] });
    try {
      expect(ep.nodeId).toBeUndefined();
      expect(ep.directAddrs).toBeUndefined();
      const ready = await ep.start();
      expect(ready.nodeId).toMatch(/^fake-\d+$/);
      expect(ready.directAddrs).toEqual([`127.0.0.1:${ready.nodeId.slice("fake-".length)}`]);
      expect(ready.relayUrl).toBe("https://relay.test.example");
      expect(ep.nodeId).toBe(ready.nodeId);
      expect(ep.directAddrs).toEqual(ready.directAddrs);
      await expect(ep.isAvailable()).resolves.toBe(true);
    } finally {
      await ep.close();
    }
  }, 15_000);

  it("two fakes exchange payloads both ways, bytes verbatim", async () => {
    const a = fakeEndpoint();
    const b = fakeEndpoint();
    try {
      const inA = collector(a);
      const inB = collector(b);
      const ra = await a.start();
      const rb = await b.start();

      const toB = new Uint8Array([...new TextEncoder().encode('{"wire":"é ✓ 🌱"}'), ...randomBytes(64)]);
      await a.send({ nodeId: rb.nodeId, relayUrls: [], directAddrs: rb.directAddrs }, toB);
      expect(await inB.next()).toEqual(toB);

      const toA = new Uint8Array(randomBytes(300));
      await b.send({ nodeId: ra.nodeId, directAddrs: ra.directAddrs }, toA);
      expect(await inA.next()).toEqual(toA);
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  }, 15_000);

  it("lazily spawns on first send", async () => {
    const spawned: ChildProcess[] = [];
    const a = fakeEndpoint({ spawned });
    const b = fakeEndpoint();
    try {
      const inB = collector(b);
      const rb = await b.start();
      expect(spawned).toHaveLength(0);
      await a.send({ nodeId: rb.nodeId, directAddrs: rb.directAddrs }, new Uint8Array([1, 2, 3]));
      expect(spawned).toHaveLength(1);
      expect(await inB.next()).toEqual(new Uint8Array([1, 2, 3]));
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  }, 15_000);

  it("maps sidecar errors to Errors whose message starts with the code", async () => {
    const a = fakeEndpoint();
    try {
      await a.start();
      await expect(a.send({ nodeId: "fake-1", relayUrls: [], directAddrs: [] }, new Uint8Array([1]))).rejects.toThrow(/^unreachable: /);
      await expect(a.send({ nodeId: "fake-1", relayUrls: ["fail://relay.test"] }, new Uint8Array([1]))).rejects.toThrow(/^unreachable: /);
      // the endpoint survives a failed request
      await expect(a.isAvailable()).resolves.toBe(true);
    } finally {
      await a.close();
    }
  }, 15_000);

  it("rejects with timeout when the sidecar never answers a request", async () => {
    const a = fakeEndpoint({ requestTimeoutMs: 300 });
    try {
      await a.start();
      const t0 = Date.now();
      await expect(a.send({ nodeId: "fake-1", relayUrls: ["slow://relay.test"] }, new Uint8Array([1]))).rejects.toThrow(/^timeout: /);
      expect(Date.now() - t0).toBeLessThan(3000);
    } finally {
      await a.close();
    }
  }, 15_000);

  it("never-ready: start rejects after readyTimeoutMs, isAvailable is false, the child is killed", async () => {
    const spawned: ChildProcess[] = [];
    const a = fakeEndpoint({ mode: "never-ready", readyTimeoutMs: 400, spawned });
    try {
      await expect(a.start()).rejects.toThrow(/^timeout: /);
      await expect(a.isAvailable()).resolves.toBe(false);
      await expect(a.send({ nodeId: "fake-1", directAddrs: ["127.0.0.1:9"] }, new Uint8Array([1]))).rejects.toThrow();
      await waitFor(() => spawned[0].exitCode !== null || spawned[0].signalCode !== null);
    } finally {
      await a.close();
    }
  }, 15_000);

  it("crash after ready: the pending send rejects closed and isAvailable is false", async () => {
    const a = fakeEndpoint({ mode: "crash-after-ready" });
    try {
      await a.start();
      await expect(a.send({ nodeId: "fake-1", directAddrs: ["127.0.0.1:9"] }, new Uint8Array([1]))).rejects.toThrow(/^closed: /);
      await expect(a.isAvailable()).resolves.toBe(false);
      await expect(a.send({ nodeId: "fake-1", directAddrs: ["127.0.0.1:9"] }, new Uint8Array([1]))).rejects.toThrow(/^closed: /);
    } finally {
      await a.close();
    }
  }, 15_000);

  it("close() makes the child exit 0 and later sends reject closed", async () => {
    const spawned: ChildProcess[] = [];
    const a = fakeEndpoint({ spawned });
    await a.start();
    await a.close();
    expect(spawned[0].exitCode).toBe(0);
    await expect(a.isAvailable()).resolves.toBe(false);
    await expect(a.send({ nodeId: "fake-1", directAddrs: ["127.0.0.1:9"] }, new Uint8Array([1]))).rejects.toThrow(/^closed: /);
    await a.close(); // idempotent
  }, 15_000);
});

describe("IrohSidecarEndpoint (missing binary)", () => {
  it("is unavailable, rejects send, and never spawns", async () => {
    const saved = { p: process.env.PATH, s: process.env.TRUSTWEB_IROH_SIDECAR };
    process.env.PATH = "";
    delete process.env.TRUSTWEB_IROH_SIDECAR;
    let ep: IrohSidecarEndpoint;
    const calls: unknown[][] = [];
    try {
      ep = new IrohSidecarEndpoint({ spawnImpl: scriptedSpawn(new ScriptedChild(), calls) });
    } finally {
      process.env.PATH = saved.p;
      if (saved.s === undefined) delete process.env.TRUSTWEB_IROH_SIDECAR;
      else process.env.TRUSTWEB_IROH_SIDECAR = saved.s;
    }
    await expect(ep.isAvailable()).resolves.toBe(false);
    await expect(ep.send({ nodeId: "n", directAddrs: ["127.0.0.1:9"] }, new Uint8Array([1]))).rejects.toThrow(/^unavailable: /);
    await expect(ep.start()).rejects.toThrow(/^unavailable: /);
    expect(calls).toHaveLength(0);
    await ep.close();
  });

  it("a binaryPath that fails to spawn makes the endpoint unavailable", async () => {
    const ep = new IrohSidecarEndpoint({ binaryPath: path.join(path.sep, "nonexistent", "trustweb-iroh-sidecar-test") });
    await expect(ep.start()).rejects.toThrow();
    await expect(ep.isAvailable()).resolves.toBe(false);
    await ep.close();
  });
});

describe("IrohSidecarEndpoint (scripted child)", () => {
  it("passes CLI flags from the options", async () => {
    const child = new ScriptedChild();
    const calls: unknown[][] = [];
    const ep = new IrohSidecarEndpoint({
      binaryPath: "/x/trustweb-iroh-sidecar",
      relayUrls: ["https://r1.test.example", "https://r2.test.example"],
      n0Relays: true,
      alpn: "trustweb/test/0",
      secretKeyFile: "/tmp/test-key",
      spawnImpl: scriptedSpawn(child, calls),
    });
    const started = ep.start();
    child.stdout.write('{"type":"ready","v":1,"nodeId":"node-x","directAddrs":[],"relayUrl":null}\n');
    await started;
    expect(calls[0][0]).toBe("/x/trustweb-iroh-sidecar");
    expect(calls[0][1]).toEqual([
      "--relay-url", "https://r1.test.example",
      "--relay-url", "https://r2.test.example",
      "--alpn", "trustweb/test/0",
      "--secret-key-file", "/tmp/test-key",
      "--n0-relays",
    ]);
    const closing = ep.close();
    await tick();
    child.exit(0);
    await closing;
  });

  it("buffers partial stdout lines (incl. a split multi-byte char) and maps send/sent/recv exactly", async () => {
    const child = new ScriptedChild();
    const logs: [string, string][] = [];
    const ep = new IrohSidecarEndpoint({
      binaryPath: "/x/sidecar",
      spawnImpl: scriptedSpawn(child),
      onLog: (level, message) => logs.push([level, message]),
    });
    const received: Uint8Array[] = [];
    ep.onReceive((p) => received.push(p));
    const started = ep.start();

    const ready = Buffer.from('{"type":"ready","v":1,"nodeId":"node-x","directAddrs":["127.0.0.1:7"],"relayUrl":null}\n{"type":"log","level":"info","message":"héllo"}\n{"type":"re');
    const cut = ready.indexOf(Buffer.from("é")) + 1; // split inside the 2-byte é
    child.stdout.write(ready.subarray(0, 20));
    await tick();
    expect(ep.nodeId).toBeUndefined();
    child.stdout.write(ready.subarray(20, cut));
    await tick();
    child.stdout.write(ready.subarray(cut));
    const info = await started;
    expect(info).toEqual({ nodeId: "node-x", directAddrs: ["127.0.0.1:7"], relayUrl: null });
    expect(logs).toContainEqual(["info", "héllo"]);

    const payload = new Uint8Array([0, 255, 10, 13, 34, 92]);
    child.stdout.write(`cv","from":"node-y","payload":"${Buffer.from(payload).toString("base64")}"}\n`);
    await tick();
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(payload);

    const sending = ep.send({ nodeId: "node-y", relayUrls: ["https://r1.test.example", "https://r2.test.example"], directAddrs: ["10.0.0.2:1"] }, payload);
    await tick();
    const line = child.linesWritten().at(-1)!;
    expect(line).toMatchObject({
      type: "send",
      nodeId: "node-y",
      relayUrl: "https://r1.test.example",
      directAddrs: ["10.0.0.2:1"],
      payload: Buffer.from(payload).toString("base64"),
    });
    expect(typeof line.id).toBe("string");
    child.stdout.write(`{"type":"sent","id":"wrong-id","via":"direct"}\n`);
    child.stdout.write(`not json at all\n`);
    child.stdout.write(`{"type":"sent","id":${JSON.stringify(line.id)},"via":"relay","extra":1}\n`);
    await sending;
    expect(logs.some(([lvl, m]) => lvl === "warn" && /malformed/i.test(m))).toBe(true);

    // relayUrl null when the peer has no relays; ids are unique
    const s2 = ep.send({ nodeId: "node-y" }, payload);
    await tick();
    const line2 = child.linesWritten().at(-1)!;
    expect(line2.relayUrl).toBeNull();
    expect(line2.id).not.toBe(line.id);
    child.stdout.write(`{"type":"error","id":${JSON.stringify(line2.id)},"code":"too_large","message":"x"}\n`);
    await expect(s2).rejects.toThrow(/^too_large: /);

    const closing = ep.close();
    await tick();
    expect(child.linesWritten().at(-1)).toEqual({ type: "close" });
    child.exit(0);
    await closing;
    expect(child.signals).toHaveLength(0);
  });

  it("close() escalates to SIGTERM after 2 s when the child ignores close", async () => {
    const child = new ScriptedChild();
    const ep = new IrohSidecarEndpoint({ binaryPath: "/x/sidecar", spawnImpl: scriptedSpawn(child) });
    const started = ep.start();
    child.stdout.write('{"type":"ready","v":1,"nodeId":"node-x","directAddrs":[],"relayUrl":null}\n');
    await started;
    const t0 = Date.now();
    await ep.close();
    expect(child.signals[0]).toBe("SIGTERM");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1900);
  }, 10_000);

  it("process exit rejects every pending request with closed", async () => {
    const child = new ScriptedChild();
    const ep = new IrohSidecarEndpoint({ binaryPath: "/x/sidecar", spawnImpl: scriptedSpawn(child) });
    const started = ep.start();
    child.stdout.write('{"type":"ready","v":1,"nodeId":"node-x","directAddrs":[],"relayUrl":null}\n');
    await started;
    const p1 = ep.send({ nodeId: "a" }, new Uint8Array([1]));
    const p2 = ep.send({ nodeId: "b" }, new Uint8Array([2]));
    child.exit(1);
    await expect(p1).rejects.toThrow(/^closed: /);
    await expect(p2).rejects.toThrow(/^closed: /);
    await expect(ep.isAvailable()).resolves.toBe(false);
  });
});

describe("fake sidecar protocol conformance", () => {
  it("answers ping, bad lines, unknown types and oversized payloads per the spec", async () => {
    const child = spawn(process.execPath, [FAKE], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, FAKE_SIDECAR_MODE: "" } });
    const lines: Record<string, unknown>[] = [];
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        lines.push(JSON.parse(buf.slice(0, i)) as Record<string, unknown>);
        buf = buf.slice(i + 1);
      }
    });
    const exited = new Promise<number | null>((r) => child.on("exit", (c) => r(c)));
    await waitFor(() => lines.length >= 1);
    expect(lines[0]).toMatchObject({ type: "ready", v: 1, relayUrl: null });
    child.stdin.write('{"type":"ping","id":"p1"}\n');
    child.stdin.write("{oops\n");
    child.stdin.write('{"type":"frobnicate","id":"f1"}\n');
    child.stdin.write('{"type":"send","id":"s1"}\n');
    const big = Buffer.alloc(1024 * 1024 + 1, 7).toString("base64");
    child.stdin.write(`{"type":"send","id":"s2","nodeId":"fake-1","relayUrl":null,"directAddrs":["127.0.0.1:9"],"payload":"${big}"}\n`);
    await waitFor(() => lines.length >= 6, 5000);
    expect(lines[1]).toEqual({ type: "pong", id: "p1" });
    expect(lines[2]).toMatchObject({ type: "error", id: null, code: "bad_request" });
    expect(lines[3]).toMatchObject({ type: "error", id: "f1", code: "bad_request" });
    expect(lines[4]).toMatchObject({ type: "error", id: "s1", code: "bad_request" });
    expect(lines[5]).toMatchObject({ type: "error", id: "s2", code: "too_large" });
    child.stdin.end(); // EOF == close
    expect(await exited).toBe(0);
  }, 15_000);
});
