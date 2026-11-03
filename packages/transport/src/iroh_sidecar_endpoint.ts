// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// IrohSidecarEndpoint — the TypeScript side of IrohEndpointLike, talking to the
// `trustweb-iroh-sidecar` process (the real iroh node, Rust) over JSON lines on
// stdin/stdout. The contract is docs/IROH-SIDECAR.md; nothing else crosses the
// process boundary, so this package keeps no native dependency (I5).
//
// Like IrohRelayChannel, this only moves bytes: payloads go out verbatim as
// base64 and come back verbatim as Uint8Array. It never logs payload bytes.
// Relay choice and failover stay in IrohRelayChannel: each `send` carries at
// most one relay (addr.relayUrls[0]).
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { IrohEndpointLike, IrohPeerAddr } from "./iroh_relay_channel.js";

export const IROH_SIDECAR_BINARY = "trustweb-iroh-sidecar";
export const IROH_SIDECAR_ENV = "TRUSTWEB_IROH_SIDECAR";

/**
 * Locate the sidecar binary: `TRUSTWEB_IROH_SIDECAR` if set (and only that path,
 * so a misconfigured override is not silently replaced), else the first
 * `trustweb-iroh-sidecar` (also `.exe` on Windows) on PATH. Nothing found → undefined.
 */
export function findIrohSidecar(
  env: Record<string, string | undefined> = process.env,
  pathExists: (p: string) => boolean = fs.existsSync,
): string | undefined {
  const override = env[IROH_SIDECAR_ENV];
  if (override) return pathExists(override) ? override : undefined;
  const searchPath = env.PATH ?? env.Path ?? "";
  const names = process.platform === "win32" ? [`${IROH_SIDECAR_BINARY}.exe`, IROH_SIDECAR_BINARY] : [IROH_SIDECAR_BINARY];
  for (const dir of searchPath.split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (pathExists(candidate)) return candidate;
    }
  }
  return undefined;
}

export type IrohSidecarLogLevel = "info" | "warn" | "error";

export interface IrohSidecarEndpointOptions {
  /** Sidecar binary; defaults to findIrohSidecar(), resolved once at construction. */
  binaryPath?: string;
  /** `--relay-url` flags, in preference order. None = direct connections only (I9). */
  relayUrls?: string[];
  /** `--n0-relays`: opt in to n0's public relays (outside the EU). Never implied. */
  n0Relays?: boolean;
  /** `--alpn`; the sidecar defaults to `trustweb/didcomm/0.1`. */
  alpn?: string;
  /** `--secret-key-file`: persist the node key so the node id survives restarts. */
  secretKeyFile?: string;
  /** How long to wait for the `ready` line. Default 10 s. */
  readyTimeoutMs?: number;
  /** How long to wait for the answer to one request. Default 15 s. */
  requestTimeoutMs?: number;
  /** Injected for tests; defaults to child_process.spawn. */
  spawnImpl?: typeof nodeSpawn;
  /** Diagnostics (never payload bytes). Sidecar `log` lines and stderr land here too. */
  onLog?: (level: IrohSidecarLogLevel, message: string) => void;
}

export interface IrohSidecarReady {
  nodeId: string;
  directAddrs: string[];
  relayUrl: string | null;
}

/** An error reported by (or about) the sidecar; `message` starts with `<code>: `. */
export class IrohSidecarError extends Error {
  constructor(
    readonly code: string,
    detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = "IrohSidecarError";
  }
}

export const DEFAULT_READY_TIMEOUT_MS = 10_000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const CLOSE_SIGTERM_MS = 2_000;
const CLOSE_SIGKILL_MS = 5_000;
/** isAvailable() pings when nothing was heard from the sidecar for this long. */
const IDLE_PING_MS = 30_000;
const PING_TIMEOUT_MS = 5_000;
/** Inbound payloads held while no receiver is registered (they are already acked to the sender). */
const MAX_UNCLAIMED_INBOUND = 256;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

interface Pending {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class IrohSidecarEndpoint implements IrohEndpointLike {
  private readonly binary: string | undefined;
  private readonly opts: IrohSidecarEndpointOptions;
  private readonly readyTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly spawnImpl: typeof nodeSpawn;
  private readonly idPrefix = randomBytes(6).toString("hex");
  private nextId = 0;

  private child: ChildProcess | undefined;
  private startPromise: Promise<IrohSidecarReady> | undefined;
  private readyInfo: IrohSidecarReady | undefined;
  private resolveReady: ((info: IrohSidecarReady) => void) | undefined;
  private rejectReady: ((err: Error) => void) | undefined;
  /** Set once the sidecar is unusable for good (exited, never ready, closed). */
  private dead: IrohSidecarError | undefined;
  private exitPromise: Promise<void> | undefined;
  private closePromise: Promise<void> | undefined;
  private readonly pending = new Map<string, Pending>();
  private receiver: ((payload: Uint8Array) => void) | undefined;
  private readonly unclaimed: Uint8Array[] = [];
  private lastHeard = 0;

  constructor(opts: IrohSidecarEndpointOptions = {}) {
    this.opts = opts;
    this.binary = opts.binaryPath ?? findIrohSidecar();
    this.readyTimeoutMs = opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.spawnImpl = opts.spawnImpl ?? nodeSpawn;
  }

  /** The node id from `ready`; undefined before ready. */
  get nodeId(): string | undefined {
    return this.readyInfo?.nodeId;
  }

  /** The direct addresses from `ready`; undefined before ready. */
  get directAddrs(): string[] | undefined {
    return this.readyInfo ? [...this.readyInfo.directAddrs] : undefined;
  }

  /** The home relay from `ready` (null = none); undefined before ready. */
  get relayUrl(): string | null | undefined {
    return this.readyInfo?.relayUrl;
  }

  /** Spawn the sidecar (once) and wait for its `ready` line. Also happens lazily on first use. */
  start(): Promise<IrohSidecarReady> {
    if (!this.startPromise) this.startPromise = this.spawnAndWait();
    return this.startPromise;
  }

  async send(addr: IrohPeerAddr, payload: Uint8Array): Promise<void> {
    await this.start();
    await this.request({
      type: "send",
      nodeId: addr.nodeId,
      relayUrl: addr.relayUrls?.[0] ?? null,
      directAddrs: addr.directAddrs ?? [],
      payload: Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).toString("base64"),
    });
  }

  onReceive(cb: (payload: Uint8Array) => void): void {
    this.receiver = cb;
    for (const p of this.unclaimed.splice(0)) this.deliverInbound(p);
  }

  async isAvailable(): Promise<boolean> {
    if (!this.binary || this.dead) return false;
    try {
      await this.start();
    } catch {
      return false;
    }
    if (this.dead) return false;
    if (Date.now() - this.lastHeard < IDLE_PING_MS) return true;
    try {
      await this.request({ type: "ping" }, Math.min(this.requestTimeoutMs, PING_TIMEOUT_MS));
      return true;
    } catch {
      return false;
    }
  }

  close(): Promise<void> {
    if (!this.closePromise) this.closePromise = this.doClose();
    return this.closePromise;
  }

  // ---- internals ----

  private log(level: IrohSidecarLogLevel, message: string): void {
    try {
      this.opts.onLog?.(level, message);
    } catch {
      /* a broken logger must not break the endpoint */
    }
  }

  private args(): string[] {
    const a: string[] = [];
    for (const url of this.opts.relayUrls ?? []) a.push("--relay-url", url);
    if (this.opts.alpn !== undefined) a.push("--alpn", this.opts.alpn);
    if (this.opts.secretKeyFile !== undefined) a.push("--secret-key-file", this.opts.secretKeyFile);
    if (this.opts.n0Relays) a.push("--n0-relays");
    return a;
  }

  private spawnAndWait(): Promise<IrohSidecarReady> {
    if (this.dead) return Promise.reject(this.dead);
    if (!this.binary) {
      return Promise.reject(new IrohSidecarError("unavailable", `no ${IROH_SIDECAR_BINARY} binary found (set ${IROH_SIDECAR_ENV} or put it on PATH)`));
    }
    return new Promise<IrohSidecarReady>((resolve, reject) => {
      const readyTimer = setTimeout(() => {
        this.fail(new IrohSidecarError("timeout", `iroh sidecar did not report ready within ${this.readyTimeoutMs} ms`));
        this.terminate();
      }, this.readyTimeoutMs);
      this.resolveReady = (info) => {
        clearTimeout(readyTimer);
        resolve(info);
      };
      this.rejectReady = (err) => {
        clearTimeout(readyTimer);
        reject(err);
      };

      let child: ChildProcess;
      try {
        child = this.spawnImpl(this.binary!, this.args(), { stdio: ["pipe", "pipe", "pipe"] });
      } catch (err) {
        this.fail(new IrohSidecarError("unavailable", `could not spawn iroh sidecar: ${(err as Error).message}`));
        return;
      }
      this.child = child;
      this.exitPromise = new Promise<void>((done) => {
        let finished = false;
        const onGone = (detail: string) => {
          if (finished) return;
          finished = true;
          this.fail(new IrohSidecarError("closed", detail));
          done();
        };
        // 'close' fires after stdout is drained, so a final `sent` is not lost.
        child.once("close", (code: number | null, signal: string | null) =>
          onGone(`iroh sidecar exited (${signal ? `signal ${signal}` : `code ${code}`})`),
        );
        child.once("error", (err: Error) => {
          this.log("error", `iroh sidecar process error: ${err.message}`);
          // A spawn failure (e.g. ENOENT) may never emit 'close'.
          if (child.pid === undefined) onGone(`could not start iroh sidecar: ${err.message}`);
        });
      });
      child.stdin?.on("error", (err: Error) => this.log("warn", `iroh sidecar stdin: ${err.message}`));

      const decoder = new StringDecoder("utf8");
      let buf = "";
      child.stdout?.on("data", (chunk: Buffer | string) => {
        buf += typeof chunk === "string" ? chunk : decoder.write(chunk);
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          this.handleLine(line);
        }
      });

      const errDecoder = new StringDecoder("utf8");
      let errBuf = "";
      child.stderr?.on("data", (chunk: Buffer | string) => {
        errBuf += typeof chunk === "string" ? chunk : errDecoder.write(chunk);
        let nl: number;
        while ((nl = errBuf.indexOf("\n")) >= 0) {
          const line = errBuf.slice(0, nl).trimEnd();
          errBuf = errBuf.slice(nl + 1);
          if (line) this.log("info", `sidecar stderr: ${line}`);
        }
      });
    });
  }

  private handleLine(raw: string): void {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.trim() === "") return;
    let msg: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      msg = parsed as Record<string, unknown>;
    } catch {
      this.log("warn", `malformed line from iroh sidecar ignored (${line.length} chars)`);
      return;
    }
    this.lastHeard = Date.now();
    switch (msg.type) {
      case "ready": {
        const { nodeId, directAddrs, relayUrl } = msg;
        if (
          typeof nodeId !== "string" || nodeId === "" ||
          !Array.isArray(directAddrs) || !directAddrs.every((a) => typeof a === "string") ||
          !(relayUrl === null || relayUrl === undefined || typeof relayUrl === "string")
        ) {
          this.log("warn", "malformed ready line from iroh sidecar ignored");
          return;
        }
        if (this.readyInfo) {
          this.log("warn", "duplicate ready line from iroh sidecar ignored");
          return;
        }
        if (msg.v !== 1) this.log("warn", `iroh sidecar speaks protocol v${String(msg.v)}, expected v1`);
        this.readyInfo = { nodeId, directAddrs: [...(directAddrs as string[])], relayUrl: (relayUrl as string | null | undefined) ?? null };
        this.resolveReady?.(this.readyInfo);
        return;
      }
      case "recv": {
        const payload = msg.payload;
        if (typeof payload !== "string" || payload.length % 4 !== 0 || !BASE64_RE.test(payload)) {
          this.log("warn", "malformed recv line from iroh sidecar ignored");
          return;
        }
        this.deliverInbound(Uint8Array.from(Buffer.from(payload, "base64")));
        return;
      }
      case "sent":
      case "pong": {
        const p = typeof msg.id === "string" ? this.takePending(msg.id) : undefined;
        if (p) p.resolve();
        else this.log("warn", `iroh sidecar answered unknown request id (${String(msg.type)})`);
        return;
      }
      case "error": {
        const code = typeof msg.code === "string" && msg.code ? msg.code : "internal";
        const detail = typeof msg.message === "string" ? msg.message : "";
        const p = typeof msg.id === "string" ? this.takePending(msg.id) : undefined;
        if (p) p.reject(new IrohSidecarError(code, detail));
        else this.log("warn", `iroh sidecar error without a pending request: ${code}: ${detail}`);
        return;
      }
      case "log": {
        const level: IrohSidecarLogLevel = msg.level === "warn" ? "warn" : "info";
        this.log(level, typeof msg.message === "string" ? msg.message : "");
        return;
      }
      default:
        this.log("info", `unknown line type from iroh sidecar ignored: ${JSON.stringify(msg.type)}`);
    }
  }

  private deliverInbound(payload: Uint8Array): void {
    if (!this.receiver) {
      if (this.unclaimed.length >= MAX_UNCLAIMED_INBOUND) {
        this.unclaimed.shift();
        this.log("warn", "inbound iroh payload dropped: no receiver registered");
      }
      this.unclaimed.push(payload);
      return;
    }
    try {
      this.receiver(payload);
    } catch (err) {
      this.log("error", `inbound iroh payload handler threw: ${(err as Error).message}`);
    }
  }

  private takePending(id: string): Pending | undefined {
    const p = this.pending.get(id);
    if (p) {
      clearTimeout(p.timer);
      this.pending.delete(id);
    }
    return p;
  }

  private request(line: Record<string, unknown>, timeoutMs = this.requestTimeoutMs): Promise<void> {
    if (this.dead) return Promise.reject(this.dead);
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) return Promise.reject(new IrohSidecarError("closed", "iroh sidecar stdin is closed"));
    const id = `${this.idPrefix}-${this.nextId++}`;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new IrohSidecarError("timeout", `no answer from iroh sidecar within ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      stdin.write(JSON.stringify({ ...line, id }) + "\n");
    });
  }

  /** Mark the sidecar unusable: reject start and every pending request. Idempotent; first reason wins. */
  private fail(err: IrohSidecarError): void {
    if (!this.dead) this.dead = err;
    this.rejectReady?.(this.dead);
    this.resolveReady = undefined;
    this.rejectReady = undefined;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      this.pending.delete(id);
      p.reject(err.code === "closed" ? err : new IrohSidecarError("closed", err.message));
    }
  }

  private alive(): boolean {
    const c = this.child;
    return !!c && c.exitCode === null && c.signalCode === null && c.pid !== undefined;
  }

  /** Ask politely, then SIGTERM after 2 s, SIGKILL after 5 s; resolves when the child is gone. */
  private async terminate(): Promise<void> {
    const child = this.child;
    if (!child || !this.exitPromise) return;
    if (this.alive()) {
      try {
        child.stdin?.end(JSON.stringify({ type: "close" }) + "\n");
      } catch {
        /* stdin already gone */
      }
    }
    const timers = [
      setTimeout(() => this.alive() && child.kill("SIGTERM"), CLOSE_SIGTERM_MS),
      setTimeout(() => this.alive() && child.kill("SIGKILL"), CLOSE_SIGKILL_MS),
    ];
    try {
      await this.exitPromise;
    } finally {
      for (const t of timers) clearTimeout(t);
    }
  }

  private async doClose(): Promise<void> {
    // Reject an in-flight start and pending requests now; the exit handler would do it too, later.
    // fail() keeps an earlier reason (e.g. the process already exited).
    this.fail(new IrohSidecarError("closed", "iroh sidecar endpoint closed"));
    await this.terminate();
  }
}
