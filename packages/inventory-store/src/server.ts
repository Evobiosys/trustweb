// Dashboard: vanilla JS + tiny node:http server, no framework (spec §4).
// Bind 127.0.0.1 only. Editable dashboard = edits become supersessions, never
// mutations.
import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendRecord,
  currentView,
  history,
  listAll,
  PoolCoverageWarning,
  renderMd,
  supersede,
  UnknownRecordError,
  AlreadySupersededError,
} from "./store.js";
import { runQuery } from "./query.js";
import { InvalidRecordError } from "./validate.js";
import type { NewInventoryRecordInput } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const staticDir = join(here, "..", "static");

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function serveStatic(res: ServerResponse, file: string): void {
  const ext = file.slice(file.lastIndexOf("."));
  try {
    const body = readFileSync(join(staticDir, file));
    res.writeHead(200, { "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    json(res, 404, { error: "not found" });
  }
}

export interface CreateServerOptions {
  inventoryPath: string;
  mdOutPath?: string;
}

// Returns an unstarted http.Server — the caller controls listen()/close(), so
// tests can bind an ephemeral port and close it in afterAll.
export function createInventoryServer(opts: CreateServerOptions): Server {
  const path = opts.inventoryPath;
  const mdOutPath = opts.mdOutPath ?? join(dirname(path), "inventory.md");

  return createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const p = url.pathname;
    try {
      if (req.method === "GET" && (p === "/" || p === "/index.html")) return serveStatic(res, "index.html");
      if (req.method === "GET" && p === "/app.js") return serveStatic(res, "app.js");
      if (req.method === "GET" && p === "/style.css") return serveStatic(res, "style.css");
      if (req.method === "GET" && p === "/favicon.ico") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === "GET" && p === "/api/current") {
        return json(res, 200, await currentView(path));
      }

      if (req.method === "GET" && p === "/api/all") {
        return json(res, 200, await listAll(path));
      }

      const historyMatch = p.match(/^\/api\/history\/([^/]+)$/);
      if (req.method === "GET" && historyMatch) {
        return json(res, 200, await history(path, historyMatch[1]!));
      }

      if (req.method === "POST" && p === "/api/records") {
        const body = (await readBody(req)) as NewInventoryRecordInput & { confirmed?: boolean };
        const { confirmed, ...input } = body;
        const record = await appendRecord(path, input, { confirmed });
        return json(res, 200, { record });
      }

      const supersedeMatch = p.match(/^\/api\/records\/([^/]+)\/supersede$/);
      if (req.method === "POST" && supersedeMatch) {
        const body = await readBody(req);
        const { confirmed, ...patch } = body;
        const record = await supersede(path, supersedeMatch[1]!, patch, { confirmed });
        return json(res, 200, { record });
      }

      if (req.method === "GET" && p === "/api/md") {
        await renderMd(path, mdOutPath);
        res.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
        res.end(readFileSync(mdOutPath, "utf8"));
        return;
      }

      if (req.method === "POST" && p === "/api/query") {
        const body = await readBody(req);
        const requester = String(body.requester ?? "").trim();
        const text = String(body.text ?? "").trim();
        if (!text || !requester) return json(res, 400, { error: "requester and text required" });
        const trace = await runQuery(path, { text, requester, gates: body.gates, k: body.k });
        return json(res, 200, trace);
      }

      json(res, 404, { error: "not found" });
    } catch (err) {
      if (err instanceof PoolCoverageWarning) {
        return json(res, 200, { warning: err.warning, poolId: err.poolId });
      }
      if (err instanceof UnknownRecordError || err instanceof AlreadySupersededError) {
        return json(res, 404, { error: err.message });
      }
      if (err instanceof InvalidRecordError) {
        return json(res, 400, { error: err.message });
      }
      console.error(err);
      json(res, 500, { error: "internal error" });
    }
  });
}

// Manual run: `pnpm --filter @resource-web/inventory-store dashboard`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { homedir } = await import("node:os");
  const inventoryPath =
    process.env.INVENTORY_STORE_PATH ?? join(homedir(), ".local", "share", "rebiosys", "inventory.jsonl");
  const port = Number(process.env.INVENTORY_STORE_PORT ?? 4791);
  const server = createInventoryServer({ inventoryPath });
  server.listen(port, "127.0.0.1", () => {
    console.log("… inventory-store dashboard running …");
    console.log(`--------`);
    console.log(`dashboard  http://127.0.0.1:${port}/`);
    console.log(`inventory  ${inventoryPath}`);
  });
}
