// Per-peer contracts: an owner-and-requester agreed override of the
// k-anonymity floor (the single DEFAULT_K exported by
// @resource-web/network-access). Jakob's 2026-08-25 decision reads "set the
// default floor to 7, and let people adjust that in 'contracts' with each
// other"; the trunk floor is 3 until the C-08 prevalence run retunes it, and
// this module reads whatever that one constant says rather than hard-coding
// a value of its own. `reference` is a free-text pointer to
// wherever that agreement actually lives (Jakob intends Consensual,
// https://consensu.al, as the human interface for making such agreements —
// this module only stores the string, no integration).
//
// Same owner-device-local rule as templates.ts: a contract can only be
// created or revoked through the functions in this file, writing the
// owner's local store; nothing an incoming query carries can create or edit
// one. Storage mirrors templates.ts exactly — append-only JSONL +
// Graffiti-style supersession (revoke = append a superseding record with
// revoked:true, never rewrite a line in place), HMAC-SHA256 canonical-JSON
// signing keyed by a local secret file (peer_contracts.secret, mode 0600,
// generated on first use via templates.ts's loadOrCreateSecret — that
// function is fully generic over its path argument, so it's reused rather
// than duplicated) so only code holding that secret can produce a record
// this store treats as valid. canonicalize/sign/verify are duplicated
// locally rather than imported from templates.ts, matching that file's own
// stated preference for small self-contained crypto helpers per module.
//
// Guardrail (Jakob, 2026-08-25): a contract may LOWER k below the default
// only with mutual:true (both sides agreed) — a one-sided contract can only
// ever raise or match the default, never lower it. This is enforced twice:
// once at creation (assertNewContractInput) and again at read time
// (effectiveKFor) — a non-mutual contract whose k_floor sits below
// *whatever the default is when it's read* is not honored as a lowering
// contract, so a later rise in the default can't retroactively turn an
// old, legally-created contract into an unauthorized downgrade. k can never
// go below MIN_K (2) regardless of mutual: at k=1 an "N of M" aggregate
// identifies a single individual outright, which is exactly what
// k-anonymity exists to prevent.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { loadOrCreateSecret } from "./templates.js";
import { DEFAULT_K } from "@resource-web/network-access";
import { peerKey } from "./contact_channels.js";

export class ContractError extends Error {}

export const MIN_K = 2;

/** One agreed (owner, peer) k-anonymity override. `sig` covers every other
 * field below via canonical JSON + HMAC-SHA256. */
export interface PeerContract {
  id: string;
  peer_id: string;
  k_floor: number;
  /** true only when both sides explicitly agreed to a floor below the
   * default — required to lower k, never required to raise it. */
  mutual: boolean;
  agreed_at: string;
  /** Pointer to where the human agreement actually lives (e.g. a
   * consensu.al link). Never validated, never fetched. */
  reference?: string;
  /** Graffiti-style supersession: set on the record that replaces an older
   * one (e.g. a revocation). null on an original contract. */
  supersedes: string | null;
  revoked: boolean;
  sig: string;
}

export type NewContractInput = {
  peer_id: string;
  k_floor: number;
  mutual: boolean;
  reference?: string;
};

function assertNewContractInput(input: NewContractInput, defaultK: number): void {
  if (!input.peer_id.trim()) throw new ContractError("contract peer_id must be non-empty");
  if (!Number.isInteger(input.k_floor)) {
    throw new ContractError(`k_floor must be an integer, got ${input.k_floor}`);
  }
  if (input.k_floor < MIN_K) {
    throw new ContractError(
      `k_floor ${input.k_floor} is below the hard minimum of ${MIN_K} — a floor of 1 identifies individuals outright, refused`,
    );
  }
  if (input.k_floor < defaultK && !input.mutual) {
    throw new ContractError(
      `k_floor ${input.k_floor} is below the default floor of ${defaultK} and mutual is not true — a one-sided contract may only raise or match the default, never lower it`,
    );
  }
}

/** Deterministic deep-key-sorted JSON stringify, mirroring templates.ts's
 * canonicalize() (itself mirroring protocol/envelope.ts's) — duplicated
 * locally so two structurally-equal records always sign/verify the same. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const out: Record<string, unknown> = {};
    for (const key of sortedKeys) out[key] = canonicalize((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

function signableFields(c: Omit<PeerContract, "sig">): unknown {
  return canonicalize(c);
}

function sign(secret: Buffer, c: Omit<PeerContract, "sig">): string {
  return createHmac("sha256", secret).update(JSON.stringify(signableFields(c))).digest("hex");
}

/** Constant-time signature check. */
export function verifyContract(secret: Buffer, c: PeerContract): boolean {
  const { sig, ...rest } = c;
  const expected = sign(secret, rest);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function ensureFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) writeFileSync(path, "");
}

/** Raw lines in file (write/chronological) order, including superseded and
 * revoked records — the full audit trail. Malformed lines are skipped
 * (never thrown on) so one bad line can't take down the whole store. */
export function listAllContractsRaw(path: string): PeerContract[] {
  if (!existsSync(path)) return [];
  const out: PeerContract[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as PeerContract);
    } catch {
      // skip malformed line — audit-trail read stays best-effort
    }
  }
  return out;
}

/** Latest-wins, signature-verified, non-revoked contracts only — the set
 * effectiveK actually consults. A record whose signature fails verification
 * (hand-edited outside this module — e.g. someone dropping in a bare
 * `k_floor: 1` line) is excluded here even though it still appears in
 * listAllContractsRaw(). */
export function currentContractsView(path: string, secret: Buffer): PeerContract[] {
  const all = listAllContractsRaw(path);
  const byId = new Map<string, PeerContract>();
  const superseded = new Set<string>();
  for (const c of all) {
    byId.set(c.id, c);
    if (c.supersedes) superseded.add(c.supersedes);
  }
  return [...byId.values()].filter(
    (c) => !superseded.has(c.id) && !c.revoked && verifyContract(secret, c),
  );
}

/** Creates and appends a new, signed contract. Only ever called from the
 * owner's own device-side code path — never in response to anything an
 * incoming request supplies. Guardrail checked against `defaultK` (defaults
 * to the workspace-wide DEFAULT_K) at creation time; effectiveKFor()
 * re-checks the same rule at read time so a later change to the default
 * can't retroactively legalize or delegalize a stored contract's intent. */
export function createContract(
  secretPath: string,
  storePath: string,
  input: NewContractInput,
  defaultK: number = DEFAULT_K,
): PeerContract {
  assertNewContractInput(input, defaultK);
  const secret = loadOrCreateSecret(secretPath);
  const unsigned: Omit<PeerContract, "sig"> = {
    id: randomUUID(),
    peer_id: input.peer_id,
    k_floor: input.k_floor,
    mutual: input.mutual,
    agreed_at: new Date().toISOString(),
    reference: input.reference,
    supersedes: null,
    revoked: false,
  };
  const record: PeerContract = { ...unsigned, sig: sign(secret, unsigned) };
  ensureFile(storePath);
  appendFileSync(storePath, `${JSON.stringify(record)}\n`);
  return record;
}

/** Revokes a contract by appending a superseding record with revoked:true —
 * never rewrites the original line (append-only, Graffiti-style, matching
 * templates.ts's revokeTemplate()). Throws if the id is unknown or already
 * superseded/revoked. */
export function revokeContract(secretPath: string, storePath: string, id: string): PeerContract {
  const secret = loadOrCreateSecret(secretPath);
  const live = currentContractsView(storePath, secret);
  const head = live.find((c) => c.id === id);
  if (!head) throw new ContractError(`contract ${id} is not a current, valid contract`);
  const unsigned: Omit<PeerContract, "sig"> = {
    ...head,
    id: randomUUID(),
    agreed_at: new Date().toISOString(),
    supersedes: id,
    revoked: true,
  };
  const record: PeerContract = { ...unsigned, sig: sign(secret, unsigned) };
  appendFileSync(storePath, `${JSON.stringify(record)}\n`);
  return record;
}

/** Finds the live contract for one peer, matching across the same two
 * requester-string shapes contact_channels.ts's peerKey() already handles
 * (bare email vs. "Name <email>") — a contract stored against
 * "anna@example.org" must still apply when a query arrives as
 * "Anna <anna@example.org>". */
export function contractFor(contracts: PeerContract[], peerId: string): PeerContract | undefined {
  const key = peerKey(peerId);
  return contracts.find((c) => peerKey(c.peer_id) === key);
}

/** Pure: the effective k-anonymity floor for one peer, given the set of
 * currently-valid contracts. Contract value wins if present AND legal —
 * `mutual:true` or `k_floor >= defaultK` — otherwise falls back to
 * `defaultK`. This is the read-time half of the mutual-flag guardrail (see
 * file header): a non-mutual contract that would lower k below whatever the
 * default is right now is never honored as a downgrade, regardless of what
 * the default was when the contract was created. MIN_K is enforced
 * defensively even though createContract() already refuses k_floor<MIN_K —
 * a hand-crafted-but-still-correctly-signed record should never be possible,
 * but the floor holds either way. */
export function effectiveKFor(
  contracts: PeerContract[],
  peerId: string,
  defaultK: number = DEFAULT_K,
): number {
  const contract = contractFor(contracts, peerId);
  if (!contract) return defaultK;
  if (contract.k_floor < defaultK && !contract.mutual) return defaultK;
  return Math.max(contract.k_floor, MIN_K);
}

/** I/O wrapper around effectiveKFor(): loads the secret, reads the current
 * verified view from `storePath`, and resolves one peer's effective k. */
export function effectiveK(
  storePath: string,
  secretPath: string,
  peerId: string,
  defaultK: number = DEFAULT_K,
): number {
  const secret = loadOrCreateSecret(secretPath);
  const contracts = currentContractsView(storePath, secret);
  return effectiveKFor(contracts, peerId, defaultK);
}
