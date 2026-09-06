// Solo demo server: an owner inbox (the consent ladder, operated by hand) and
// a requester "ask" page. In-process only — no daemon, no relay. Run with
// `pnpm --filter @resource-web/network-access demo`, then open:
//   http://127.0.0.1:4790/        requester side (ask + poll status)
//   http://127.0.0.1:4790/inbox   owner side (gates 0/1/2)
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  applyEvent,
  GateError,
  receiveQuery,
  requesterView,
  anonymizedRevealDecision,
  KeywordContactMatcher,
  LlmContactMatcher,
  OllamaChatClient,
  QueryStore,
  loadQueryInfraConfig,
  loadProfilesFile,
  profileById,
  ProfileError,
  ReplySchedule,
  // Query-infra (2026-08-25 memo): pre-approved templates, red flags, pause,
  // vault (local-files) query target — see DECISIONS.md D22.
  createTemplate,
  revokeTemplate,
  currentView as currentTemplateView,
  listAllRaw as listAllTemplatesRaw,
  TemplateError,
  loadOrCreateSecret,
  submitQuery,
  listRedFlags,
  activeTrustPenalty,
  effectivePolicy,
  readPauseState,
  isPaused,
  setPaused,
  peekQueueLength,
  drain,
  loadVault,
  runVaultQuery,
  KeywordVaultMatcher,
  LlmVaultMatcher,
  // Owner-review UI (2026-08-25 memo, follow-on to D22): pending-approval
  // queue, reach-out channel resolution, restore-trust prompt stub — see
  // demo/review.html.
  buildReviewQueue,
  staleness,
  resolveContactOptionsFor,
  recordRestorePrompt,
  listRestorePrompts,
  latestRestorePromptFor,
} from "../src/index.js";
import type {
  ContactRecord,
  GateEffect,
  IntroQuery,
  ModelSize,
  OwnerProfile,
  RequesterPolicy,
  RevealDecision,
  QueryTemplate,
  TemplateAllowedGates,
  MatchMode,
  TemplateTarget,
  GatewayPaths,
  SubmitOutcome,
  SubmitQueryInput,
  VaultQueryTrace,
  QueueCardInput,
  PeerContactRecord,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const config = loadQueryInfraConfig();
const contactsPath = process.env.NETWORK_ACCESS_CONTACTS ?? join(here, "..", "data", "contacts.sample.json");
const contacts = JSON.parse(readFileSync(contactsPath, "utf8")) as ContactRecord[];

// Inventory records (JSONL, Graffiti-style supersession: latest record wins)
// become matchable entries alongside contacts — the network shares things AND people.
const inventoryPath =
  process.env.NETWORK_ACCESS_INVENTORY ?? join(homedir(), ".local", "share", "rebiosys", "inventory.jsonl");
function loadInventory(): ContactRecord[] {
  if (!existsSync(inventoryPath)) return [];
  const byId = new Map<string, any>();
  const superseded = new Set<string>();
  for (const line of readFileSync(inventoryPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line);
    byId.set(rec.id, rec);
    if (rec.supersedes) superseded.add(rec.supersedes);
  }
  return [...byId.values()]
    .filter((r) => !superseded.has(r.id) && r.status !== "retired" && r.status !== "gone")
    .map((r) => ({
      id: r.id,
      name: r.name,
      tags: [...(r.tags ?? []), r.category ?? ""],
      notes: [r.description ?? "", r.availability_note ?? "", r.location ?? ""].join(" "),
    }));
}
const inventory = loadInventory();
const corpus: ContactRecord[] = [...contacts, ...inventory];
const contactsById = new Map(corpus.map((c) => [c.id, c]));

// Named profiles (Delta 2): "general" + per-use-case alter egos, one JSON
// object per line. Legacy profiles.json (single array) still reads as a
// fallback if the .jsonl file is absent.
const profilesJsonlPath = join(here, "..", "data", "profiles.jsonl");
const profilesJsonPath = join(here, "..", "data", "profiles.json");
const profiles: OwnerProfile[] = existsSync(profilesJsonlPath) || existsSync(profilesJsonPath)
  ? loadProfilesFile(profilesJsonlPath, profilesJsonPath)
  : [{ id: "general", name: "Owner", contact: "connect@evobiosys.org" }];
const defaultProfile = profileById(profiles, "general");

const store = new QueryStore(join(here, "..", "data", "demo_state.json"));

// ---------------------------------------------------------------------------
// Query infra (2026-08-25 memo, DECISIONS.md D22): pre-approved templates,
// red-flag handling, pause control, local-files (vault) query target. All
// owner-local state lives under ~/.local/share/rebiosys, same directory as
// inventory.jsonl/inbox.jsonl — the owner's device store, never repo-tracked.
// NETWORK_ACCESS_STATE_DIR override (owner-review UI addition): lets a
// headless verification run point the query-infra device store at a temp
// directory instead of the real ~/.local/share/rebiosys, so exercising the
// review UI never writes test templates/red-flags into the owner's actual
// device state (see DECISIONS.md D22's note on purging test artifacts —
// this makes that purge step unnecessary going forward).
const rebiosysDir = process.env.NETWORK_ACCESS_STATE_DIR ?? join(homedir(), ".local", "share", "rebiosys");
const gatewayPaths: GatewayPaths = {
  templatesPath: join(rebiosysDir, "query_templates.jsonl"),
  templatesSecretPath: join(rebiosysDir, "query_templates.secret"),
  redFlagsPath: join(rebiosysDir, "red_flags.jsonl"),
  pauseStatePath: join(rebiosysDir, "pause_state.json"),
  pauseQueuePath: join(rebiosysDir, "pause_queue.jsonl"),
};
// Restore-trust prompt log (owner-review UI): deliberately NOT part of
// GatewayPaths — that type is submitQuery()'s input contract specifically,
// and restore-prompt recording has nothing to do with query submission.
// Keeping it a sibling const avoids widening GatewayPaths (which
// demo/query_infra_demo.ts also constructs) for an unrelated feature.
const restorePromptsPath = join(rebiosysDir, "restore_prompts.jsonl");

// Per-peer reach-out channel map (memo: "a button to reach out to the
// person over the web of trust, or matrix or signal as a fallback"). Same
// resolution shape a future transcript-derived contact-preference inference
// would populate — see contact_channels.ts's file header.
const peerContactsPath =
  process.env.NETWORK_ACCESS_PEER_CONTACTS ?? join(here, "..", "data", "peer_contacts.sample.json");
const peerContacts: PeerContactRecord[] = existsSync(peerContactsPath)
  ? (JSON.parse(readFileSync(peerContactsPath, "utf8")) as PeerContactRecord[])
  : [];

// Local-files (Obsidian-style) query target. Default points at the repo's
// synthetic fixtures corpus, resolved relative to this file (NOT computed in
// src/, which would break once tsc emits to dist/ at a different depth — see
// config.ts's vaultModel comment). Override with NETWORK_ACCESS_VAULT_PATH to
// point at a different folder; this demo never reads a real personal vault.
const vaultPath = process.env.NETWORK_ACCESS_VAULT_PATH ?? join(here, "..", "fixtures", "vault");
function loadVaultNotes() {
  return loadVault(vaultPath);
}
const vaultKeyword = new KeywordVaultMatcher();
// Deterministic by default (fast, repeatable — see config.ts's vaultUseLlm
// doc); NETWORK_ACCESS_VAULT_USE_LLM=1 swaps in the real "strongest local
// model configured" path, still falling back to vaultKeyword on any failure.
const vaultMatcher = config.vaultUseLlm
  ? new LlmVaultMatcher(new OllamaChatClient(config.ollamaUrl), config.vaultModel, vaultKeyword)
  : vaultKeyword;

// Owner-side trace annex for templated *network* queries (target: "network"):
// IntroQuery/gates.ts stay completely untouched (D19-D21 behavior unchanged)
// — this is purely an additive, server-local lookup keyed by query id, merged
// into ownerView().trace below.
const templateTraceById = new Map<
  string,
  {
    templateValidation: { status: string; template_id: string; reason?: string };
    redFlag?: unknown;
    // The policy that ACTUALLY governed this query — template.allowed_gates,
    // not store.policyFor(requester). Recorded so ownerView() below can show
    // the true gating policy instead of an unrelated standing default that
    // never applied to this templated query.
    policy: RequesterPolicy;
  }
>();

// Owner-side log of every vault query attempt (accepted-and-run, or
// red-flagged) — vault queries have no persisted state-machine object like
// IntroQuery, so this list IS their transparent trace surface (memo item 5).
interface VaultLogEntry {
  id: string;
  ts: string;
  requester: string;
  templateId: string;
  templateValidation: { status: string; template_id: string; reason?: string };
  redFlag?: unknown;
  trace?: VaultQueryTrace;
  outward: string;
}
const vaultQueryLog: VaultLogEntry[] = [];

/** Runs one submitted query through the full gateway (template validation →
 * red-flag or pause or dispatch), then dispatches an "accepted" outcome to
 * the network ladder or the vault query path per the template's target.
 * Shared by the immediate /api/query path and resumeQueue()'s replay after
 * an unpause, so both go through identical logic. */
async function dispatchQuery(input: { templateId: string; requester: string; text: string; receivedAt?: number }) {
  const outcome: SubmitOutcome = submitQuery(gatewayPaths, input);
  if (outcome.kind === "red_flag") {
    vaultQueryLog.push({
      id: randomUUID(),
      ts: new Date().toISOString(),
      requester: input.requester,
      templateId: input.templateId,
      templateValidation: outcome.templateValidation,
      redFlag: outcome.redFlag,
      outward: outcome.outward,
    });
    return { kind: "red_flag" as const, outward: outcome.outward };
  }
  if (outcome.kind === "queued") {
    return { kind: "queued" as const };
  }
  const template = outcome.template;
  if (template.target === "vault") {
    const trace = await runVaultQuery(loadVaultNotes(), vaultMatcher, {
      text: input.text,
      requester: input.requester,
      k: config.k,
      // "what gate policy let this query run at all" — the template's
      // allowed_gates, since a vault query has no ladder of its own. Cast:
      // TemplateAllowedGates has no index signature of its own, so it isn't
      // directly assignable to Record<string, unknown> — the trace field is
      // read-only display data, so a cast (not a runtime copy) is enough.
      gateStates: template.allowed_gates as unknown as Record<string, unknown>,
    });
    vaultQueryLog.push({
      id: randomUUID(),
      ts: new Date().toISOString(),
      requester: input.requester,
      templateId: template.id,
      templateValidation: outcome.templateValidation,
      trace,
      outward: trace.outward.bytes,
    });
    return { kind: "vault" as const, outward: trace.outward.bytes, trace };
  }
  // target: "network" — the existing D19-D21 consent ladder, using the
  // template's allowed_gates as the requester policy INSTEAD OF
  // store.policyFor(requester): a templated query is gated by what the
  // template itself pre-approved, not by whatever standing per-requester
  // policy happens to exist.
  const policy: RequesterPolicy = template.allowed_gates;
  const result = receiveQuery(
    { id: randomUUID(), requester: input.requester, text: input.text, receivedAt: input.receivedAt ?? Date.now() },
    policy,
  );
  store.put(result.query);
  templateTraceById.set(result.query.id, {
    templateValidation: outcome.templateValidation,
    redFlag: undefined,
    policy,
  });
  runEffects(result.query, result.effects, policy);
  return { kind: "network" as const, id: result.query.id };
}

const keyword = new KeywordContactMatcher();
function matcherFor(model: ModelSize) {
  const name = model === "small" ? config.smallModel : config.largeModel;
  return new LlmContactMatcher(new OllamaChatClient(config.ollamaUrl), name, keyword);
}

function runEffects(query: IntroQuery, effects: GateEffect[], policy: RequesterPolicy): void {
  for (const effect of effects) {
    if (effect.type === "start_match") {
      void matcherFor(effect.model)
        .match(query.text, corpus)
        .then((matches) => {
          const current = store.get(query.id);
          if (!current || current.state !== "running") return;
          const result = applyEvent(
            current,
            { type: "match_completed", matches, totalContacts: corpus.length },
            policy,
            { k: config.k, contactsById, defaultProfile },
          );
          store.put(result.query);
          // Pre-existing bug fix (found while wiring query-infra, D22): this
          // called an undefined pushResponses() — every other path that
          // answers a query (POST /api/queries/:id/event, /api/reach-out)
          // calls scheduleResponses() afterward; a completed matcher run
          // answering via an auto Gate-2 policy is exactly the same case and
          // was silently never scheduling its relay push.
          scheduleResponses();
        })
        .catch((err) => console.error(`match run failed for ${query.id}:`, err));
    }
    // "respond" effects need no I/O here: the response is stored on the query
    // and the requester page polls requesterView().
  }
}

function ownerView(q: IntroQuery) {
  const decision =
    q.matches !== undefined
      ? anonymizedRevealDecision(q.matches.length, q.totalContacts ?? 0, config.k)
      : undefined;
  const templateInfo = templateTraceById.get(q.id);
  // A templated query is gated by template.allowed_gates, NOT
  // store.policyFor(requester) — show the policy that actually governed it,
  // falling back to the standing per-requester default only for
  // non-templated (D19-D21 legacy /api/ask) queries.
  const basePolicy = templateInfo?.policy ?? store.policyFor(q.requester);
  const trustPenalty = activeTrustPenalty(gatewayPaths.redFlagsPath, q.requester);
  return {
    ...q,
    matches: q.matches?.map((m) => ({ ...m, name: contactsById.get(m.contact_id)?.name ?? m.contact_id })),
    kDecision: decision,
    policy: basePolicy,
    // Red-flag trust downgrade (memo item 2): if this requester has an
    // unexpired flag, the policy actually applied to NEW queries from them
    // is stricter than their standing grant — surfaced here so the owner
    // sees why a "standing_allow" requester is suddenly back to ask-each-time.
    trustPenalty,
    effectivePolicy: effectivePolicy(basePolicy, trustPenalty),
    // Transparent trace: what the algorithm did / would send, spelled out.
    // Additive: templateValidation/redFlag are new keys layered onto the
    // existing D19-D21 trace object — nothing here or above was renamed.
    trace:
      q.matches !== undefined
        ? {
            scanned: q.totalContacts ?? corpus.length,
            corpusSplit: { contacts: contacts.length, inventory: inventory.length },
            matchEvidence: q.matches.map((m) => ({ id: m.contact_id, score: m.score, reason: m.reason })),
            kDecision: decision,
            outwardIfAnonymized: decision ? requesterPreview(decision) : undefined,
            outwardSent: q.response?.text,
            templateValidation: templateInfo?.templateValidation,
            redFlag: templateInfo?.redFlag,
          }
        : templateInfo
          ? { templateValidation: templateInfo.templateValidation, redFlag: templateInfo.redFlag }
          : undefined,
  };
}

function requesterPreview(decision: RevealDecision): string {
  return decision.kind === "anonymized"
    ? `${decision.matchCount} of ${decision.totalCount} people in this network are sharing what you asked about.`
    : "No shareable result for this request.";
}

// ---------------------------------------------------------------------------
// Owner-review UI (demo/review.html, 2026-08-25 memo): builds the
// pending-approval queue + red-flag cards + reach-out channel lookup that
// GET /api/inbox now also returns. Additive only — nothing above this
// changes shape, inbox.html keeps working unmodified (same convention D22
// established for templateValidation/redFlag on the trace object).
function buildOwnerReviewPayload() {
  const now = Date.now();
  const pendingCards: QueueCardInput[] = store
    .list()
    .filter((q) => !["responded", "declined_reveal", "declined_gate0", "expired"].includes(q.state))
    .map((q) => {
      const templateInfo = templateTraceById.get(q.id);
      const basePolicy = templateInfo?.policy ?? store.policyFor(q.requester);
      const trustPenalty = activeTrustPenalty(gatewayPaths.redFlagsPath, q.requester);
      return {
        kind: "pending" as const,
        id: q.id,
        requester: q.requester,
        text: q.text,
        receivedAt: q.receivedAt,
        state: q.state,
        template: templateInfo ? { id: templateInfo.templateValidation.template_id, target: "network" as const } : undefined,
        policy: basePolicy,
        effectivePolicy: effectivePolicy(basePolicy, trustPenalty),
      };
    });
  const restorePromptEvents = listRestorePrompts(restorePromptsPath);
  const redFlagCards: QueueCardInput[] = listRedFlags(gatewayPaths.redFlagsPath).map((e) => ({
    kind: "red_flag" as const,
    id: e.id,
    requester: e.requester,
    receivedText: e.received_text,
    ts: e.ts,
    reason: e.reason,
    trustDowngradeExpiresAt: e.trust_downgrade.expires_at,
    restorePromptSentAt: latestRestorePromptFor(restorePromptEvents, e.id)?.ts,
  }));
  const queue = buildReviewQueue([...pendingCards, ...redFlagCards]).map((c) => ({
    ...c,
    staleness: staleness(c.kind === "red_flag" ? Date.parse(c.ts) : c.receivedAt, now),
  }));

  const allRequesters = new Set<string>([
    ...store.list().map((q) => q.requester),
    ...listRedFlags(gatewayPaths.redFlagsPath).map((e) => e.requester),
    ...vaultQueryLog.map((v) => v.requester),
  ]);
  const reachOutByRequester = resolveContactOptionsFor(peerContacts, allRequesters);

  // "Processed" list: already-answered/declined network queries + the vault
  // log, each one tap from its transparent trace (memo item 4's "trace one
  // tap away per processed query").
  const processed = store
    .list()
    .filter((q) => ["responded", "declined_reveal", "declined_gate0", "expired"].includes(q.state))
    .map((q) => ({ ...ownerView(q), staleness: staleness(q.receivedAt, now) }))
    .sort((a, b) => b.receivedAt - a.receivedAt);
  const vaultProcessed = vaultQueryLog
    .map((v) => ({ ...v, staleness: staleness(Date.parse(v.ts), now) }))
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));

  return { queue, processed, vaultProcessed, reachOutByRequester, restorePrompts: restorePromptEvents };
}

function json(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: import("node:http").IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

// ---------------------------------------------------------------------------
// Relay bridge: laptop-first inversion. rebiosys-pull fetches persisted
// queries off the questhub relay (over the existing SSH master, LuLu-proof);
// each becomes a local query walking the same consent ladder; finished
// responses are pushed back so the requester's /status link answers.
const relayMapPath = join(here, "..", "data", "relay_map.json");
const inboxPath = join(homedir(), ".local", "share", "rebiosys", "inbox.jsonl");

interface RelayMapEntry {
  localId: string;
  pushed: boolean;
}
function loadRelayMap(): Record<string, RelayMapEntry> {
  return existsSync(relayMapPath) ? JSON.parse(readFileSync(relayMapPath, "utf8")) : {};
}
function saveRelayMap(map: Record<string, RelayMapEntry>): void {
  writeFileSync(relayMapPath, JSON.stringify(map, null, 2));
}

function relayToken(): string {
  return execFileSync("security", ["find-generic-password", "-s", "rebiosys-pull", "-a", "questhub", "-w"], {
    encoding: "utf8",
  }).trim();
}

function bridgeCycle(): { ingested: number; scheduled: number; pushed: number } {
  let ingested = 0;
  try {
    execFileSync(join(homedir(), ".local", "bin", "rebiosys-pull"), [], {
      encoding: "utf8",
      cwd: homedir(),
      env: { ...process.env, PYTHONPATH: "" },
      timeout: 60_000,
    });
  } catch (err) {
    console.error("relay pull failed:", (err as Error).message.slice(0, 200));
  }
  const map = loadRelayMap();
  if (existsSync(inboxPath)) {
    for (const line of readFileSync(inboxPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const rec = JSON.parse(line);
      if (rec.kind !== "query" || map[rec.id]) continue;
      // Pause control (memo item 3): "it slows my phone/laptop" — a matcher
      // run is exactly the load this guards against. Stop at the first
      // not-yet-ingested item rather than skipping it: map[rec.id] stays
      // unset, so the next bridgeCycle() (post-resume) picks up here again —
      // relay_map.json IS the persisted queue for this path, no separate one
      // needed. This does not affect the demo (it runs with
      // NETWORK_ACCESS_NO_BRIDGE=1, and /api/query's own pause path is
      // covered by query_gateway.ts's submitQuery/pause.ts).
      if (isPaused(gatewayPaths.pauseStatePath)) break;
      const requester = rec.email || rec.name || "unknown";
      const policy = store.policyFor(requester);
      const result = receiveQuery(
        { id: randomUUID(), requester, text: rec.text, receivedAt: Date.now() },
        policy,
      );
      store.put(result.query);
      runEffects(result.query, result.effects, policy);
      map[rec.id] = { localId: result.query.id, pushed: false };
      ingested++;
    }
  }
  saveRelayMap(map);
  const scheduled = scheduleResponses();
  const pushed = flushDueResponses(Date.now());
  return { ingested, scheduled, pushed };
}

// Uniform reply scheduling (Delta 3, I3 timing-leak fix): outward responses
// don't push to the relay the instant they're ready — they're enqueued onto
// a shared 30s-default tick (config.replyTickMs) and only pushed when that
// tick fires, so a 2s approve and a 90s decline are indistinguishable at
// release time. replySchedule/scheduledRelayIds are process-local — fine for
// this single-process demo; a daemon mount would persist the queue.
const replySchedule = new ReplySchedule<string>(config.replyTickMs, 0);
const scheduledRelayIds = new Set<string>();

/** Enqueues any answered-but-not-yet-pushed relay entries onto the tick
 * schedule. Idempotent per relayId — safe to call after every event. */
function scheduleResponses(): number {
  const map = loadRelayMap();
  const now = Date.now();
  let scheduled = 0;
  for (const [relayId, entry] of Object.entries(map)) {
    if (entry.pushed || scheduledRelayIds.has(relayId)) continue;
    const q = store.get(entry.localId);
    if (!q?.response) continue;
    scheduledRelayIds.add(relayId);
    replySchedule.enqueue(relayId, now);
    scheduled++;
  }
  return scheduled;
}

/** Pushes over SSH whatever relayIds are due at `now`. Only source of actual
 * outbound relay traffic — called from the tick interval below and once at
 * the tail of bridgeCycle (so anything already due doesn't wait an extra
 * bridge cycle). */
function flushDueResponses(now: number): number {
  let pushed = 0;
  const map = loadRelayMap();
  for (const relayId of replySchedule.due(now)) {
    scheduledRelayIds.delete(relayId);
    const entry = map[relayId];
    if (!entry || entry.pushed) continue;
    const q = store.get(entry.localId);
    if (!q?.response) continue;
    const payload = JSON.stringify({ token: relayToken(), id: relayId, response: requesterView(q) });
    try {
      execFileSync(
        "ssh",
        ["questhub", `curl -s -X POST http://127.0.0.1:8095/respond -H 'content-type: application/json' -d '${payload.replace(/'/g, "'\\''")}'`],
        { encoding: "utf8", timeout: 30_000 },
      );
      entry.pushed = true;
      pushed++;
    } catch (err) {
      console.error(`response push failed for ${relayId}:`, (err as Error).message.slice(0, 200));
    }
  }
  saveRelayMap(map);
  return pushed;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  try {
    if (req.method === "GET" && (path === "/" || path === "/ask")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(readFileSync(join(here, "ask.html")));
      return;
    }
    if (req.method === "GET" && path === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "GET" && path === "/inbox") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(readFileSync(join(here, "inbox.html")));
      return;
    }
    // Owner-review UI (2026-08-25 memo): a new surface, additive — /inbox
    // above is untouched and keeps working exactly as before.
    if (req.method === "GET" && path === "/review") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(readFileSync(join(here, "review.html")));
      return;
    }
    if (req.method === "POST" && path === "/api/ask") {
      const body = await readBody(req);
      const requester = String(body.requester ?? "").trim();
      const text = String(body.text ?? "").trim();
      if (!requester || !text) return json(res, 400, { error: "requester and text required" });
      const policy = store.policyFor(requester);
      const result = receiveQuery(
        { id: randomUUID(), requester, text, receivedAt: Date.now() },
        policy,
      );
      store.put(result.query);
      runEffects(result.query, result.effects, policy);
      return json(res, 200, { id: result.query.id });
    }
    if (req.method === "GET" && path.startsWith("/api/ask/")) {
      const q = store.get(path.slice("/api/ask/".length));
      if (!q) return json(res, 404, { error: "unknown query" });
      return json(res, 200, requesterView(q));
    }
    if (req.method === "GET" && path === "/api/inbox") {
      const secret = loadOrCreateSecret(gatewayPaths.templatesSecretPath);
      return json(res, 200, {
        queries: store.list().map(ownerView),
        policies: store.listPolicies(),
        contacts: contacts.length,
        corpusTotal: corpus.length,
        k: config.k,
        // Query infra additions (memo, D22) — owner-side only:
        templates: currentTemplateView(gatewayPaths.templatesPath, secret),
        redFlags: listRedFlags(gatewayPaths.redFlagsPath),
        pause: { ...readPauseState(gatewayPaths.pauseStatePath), queueLength: peekQueueLength(gatewayPaths.pauseQueuePath) },
        vaultQueries: vaultQueryLog,
        vaultNoteCount: loadVaultNotes().length,
        // Owner-review UI additions — additive keys only, nothing above renamed.
        review: buildOwnerReviewPayload(),
      });
    }
    // Records that the owner asked for a restore-trust nudge to go out for
    // one red-flag event. Recording only — actual delivery over the
    // requester's resolved reach-out channel is TODO (see restore_prompt.ts).
    const restorePromptMatch = path.match(/^\/api\/red-flags\/([^/]+)\/restore-prompt$/);
    if (req.method === "POST" && restorePromptMatch) {
      const flagId = restorePromptMatch[1]!;
      const flag = listRedFlags(gatewayPaths.redFlagsPath).find((e) => e.id === flagId);
      if (!flag) return json(res, 404, { error: "unknown red-flag event" });
      const event = recordRestorePrompt(restorePromptsPath, { redFlagId: flag.id, requester: flag.requester });
      return json(res, 200, event);
    }
    // --- Query infra endpoints (memo, DECISIONS.md D22) ---------------------
    if (req.method === "GET" && path === "/api/templates") {
      const secret = loadOrCreateSecret(gatewayPaths.templatesSecretPath);
      return json(res, 200, {
        templates: currentTemplateView(gatewayPaths.templatesPath, secret),
        raw: listAllTemplatesRaw(gatewayPaths.templatesPath),
      });
    }
    // Owner-only, local-device action: create a pre-approved template. Never
    // reachable from anything an incoming request supplies.
    if (req.method === "POST" && path === "/api/templates") {
      const body = await readBody(req);
      const template = createTemplate(gatewayPaths.templatesSecretPath, gatewayPaths.templatesPath, {
        requester: String(body.requester ?? "").trim(),
        query_text: String(body.query_text ?? "").trim(),
        match_mode: (body.match_mode as MatchMode) ?? "exact",
        target: (body.target as TemplateTarget) ?? "vault",
        allowed_gates: (body.allowed_gates as TemplateAllowedGates) ?? {
          gate0: "standing_allow",
          gate1: "manual",
          gate2: "manual",
        },
      });
      return json(res, 200, template);
    }
    const revokeMatch = path.match(/^\/api\/templates\/([^/]+)\/revoke$/);
    if (req.method === "POST" && revokeMatch) {
      const revoked = revokeTemplate(gatewayPaths.templatesSecretPath, gatewayPaths.templatesPath, revokeMatch[1]!);
      return json(res, 200, revoked);
    }
    // The one entry point an incoming query actually uses: reference a
    // template id, nothing else. See query_gateway.ts / dispatchQuery above.
    if (req.method === "POST" && path === "/api/query") {
      const body = await readBody(req);
      const outcome = await dispatchQuery({
        templateId: String(body.templateId ?? "").trim(),
        requester: String(body.requester ?? "").trim(),
        text: String(body.text ?? "").trim(),
      });
      return json(res, 200, outcome);
    }
    if (req.method === "GET" && path === "/api/pause") {
      return json(res, 200, {
        ...readPauseState(gatewayPaths.pauseStatePath),
        queueLength: peekQueueLength(gatewayPaths.pauseQueuePath),
      });
    }
    if (req.method === "POST" && path === "/api/pause") {
      const body = await readBody(req);
      const paused = Boolean(body.paused);
      const state = setPaused(gatewayPaths.pauseStatePath, paused);
      if (!paused) {
        // Resuming: drain whatever queued while paused and run each item's
        // ORIGINAL (templateId, requester, text) back through dispatchQuery
        // — the same function a live /api/query call uses. dispatchQuery
        // re-runs submitQuery() internally, so a template revoked during the
        // pause window is honored (rejected + red-flagged) rather than
        // bypassed by a queue built before the revoke. Draining here (not
        // via query_gateway.ts's own resumeQueue()) is deliberate: that
        // function lives in src/ with no matcher/HTTP dependency, so it
        // can't itself run the vault matcher or the network ladder — see its
        // doc comment.
        const items = drain<SubmitQueryInput>(gatewayPaths.pauseQueuePath);
        const outcomes = [];
        for (const item of items) outcomes.push(await dispatchQuery(item.payload));
        return json(res, 200, { ...state, drained: outcomes.length });
      }
      return json(res, 200, state);
    }
    if (req.method === "POST" && path === "/api/policies") {
      const body = await readBody(req);
      store.setPolicy(String(body.requester), body.policy as RequesterPolicy);
      return json(res, 200, { ok: true });
    }
    const eventMatch = path.match(/^\/api\/queries\/([^/]+)\/event$/);
    if (req.method === "POST" && eventMatch) {
      const q = store.get(eventMatch[1]!);
      if (!q) return json(res, 404, { error: "unknown query" });
      const body = await readBody(req);
      let event = body.event;
      // profileId is resolved here, not inside gates.ts: profileById() throws
      // on an unknown id — never a silent fallback to a different identity.
      if (event?.type === "reveal_identity" && !event.profile) {
        event = { type: "reveal_identity", profile: profileById(profiles, event.profileId) };
      }
      const policy = store.policyFor(q.requester);
      const result = applyEvent(q, event, policy, { k: config.k, contactsById, defaultProfile });
      store.put(result.query);
      runEffects(result.query, result.effects, policy);
      scheduleResponses();
      return json(res, 200, { state: result.query.state });
    }
    if (req.method === "POST" && path === "/api/relay/bridge") {
      const report = bridgeCycle();
      return json(res, 200, report);
    }
    // The fork's Delta 1 "/api/reach-out" route (the owner reaching toward a
    // known requester with no inbound query) is deliberately NOT ported: it
    // needs the proactive_reach_out event in packages/network-access's gate
    // state machine, which is the fork half of the two competing D21
    // implementations. That unification is C-06 and is Jakob's decision, not
    // this port's. See PORTED-FROM-REBIOSYS.md, "deferred".
    json(res, 404, { error: "not found" });
  } catch (err) {
    if (err instanceof GateError) return json(res, 409, { error: err.message });
    if (err instanceof ProfileError) return json(res, 400, { error: err.message });
    if (err instanceof TemplateError) return json(res, 400, { error: err.message });
    console.error(err);
    json(res, 500, { error: "internal error" });
  }
});

const port = Number(process.env.NETWORK_ACCESS_PORT ?? 4790);
// Bind target: defaults to loopback-only (safe default, unchanged behavior).
// Set NETWORK_ACCESS_HOST=0.0.0.0 explicitly (e.g. to let a phone on the same
// LAN reach this laptop's demo) — this demo never chooses that for you.
const host = process.env.NETWORK_ACCESS_HOST ?? "127.0.0.1";
if (process.env.NETWORK_ACCESS_NO_BRIDGE !== "1") {
  setTimeout(() => {
    const r = bridgeCycle();
    console.log(`relay bridge: ingested ${r.ingested}, scheduled ${r.scheduled}, pushed ${r.pushed}`);
  }, 2_000);
  setInterval(() => bridgeCycle(), 60_000);
}
// Uniform reply-scheduling tick (Delta 3): fires independently of the relay
// bridge's own 60s pull cadence so a response's actual push always waits for
// the next shared tick, not the next bridge cycle.
setInterval(() => flushDueResponses(Date.now()), config.replyTickMs);
server.listen(port, host, () => {
  console.log("… network-access demo running …");
  console.log(`--------`);
  console.log(`bind            ${host}${host === "127.0.0.1" ? " (loopback-only)" : " (reachable on your LAN — make sure you mean this)"}`);
  console.log(`requester page  http://${host}:${port}/`);
  console.log(`owner inbox     http://${host}:${port}/inbox`);
  console.log(`contacts: ${contacts.length} (${contactsPath})`);
  console.log(`models: small=${config.smallModel} large=${config.largeModel} via ${config.ollamaUrl} (keyword fallback if unreachable)`);
});
