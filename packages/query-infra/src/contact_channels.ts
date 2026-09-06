// Owner-review UI addition (Jakob's memo: "a button to reach out to the
// person over the web of trust, or matrix or signal as a fallback").
//
// "Contact over Web of Trust" is always the primary path — it needs no
// address at all, it's just startProactiveReachOut() (see gates.ts), the
// same mechanism D21 already ships. Matrix/Signal are external, addressed
// fallbacks that only exist when the owner (or later, a transcript-derived
// inference) has recorded a channel for that specific requester. This module
// owns ONLY the lookup/resolution — no reach-out authority, no I/O, no gate
// logic (gates.ts/query_gateway.ts keep that).
//
// Storage: a small per-peer map, `{requester, preferred_channel?, matrix?,
// signal?}[]`, loaded from data/peer_contacts.sample.json by the demo server.
// `preferred_channel` is deliberately optional and forward-compatible: today
// it's hand-maintained fixture data, but the field is exactly what a future
// transcript-derived contact-preference inference would populate (same shape,
// same lookup) — nothing else in this module needs to change for that.
export type ContactChannel = "matrix" | "signal";

export interface PeerContactRecord {
  /** Matches an IntroQuery.requester string. May be a bare email
   * ("anna@example.org") or the "Name <email>" form the legacy /api/ask
   * flow uses — resolveContactOptions() normalizes both to the same key. */
  requester: string;
  /** Which fallback channel to surface first, when more than one is known.
   * Absent = no preference recorded yet (fallbacks list in a fixed order). */
  preferred_channel?: ContactChannel;
  /** mxid ("@anna:matrix.myceli.al") or a full matrix.to link. Rendered as
   * a matrix.to deep link either way. */
  matrix?: string;
  /** signal.me link, or a bare phone number rendered into one. */
  signal?: string;
}

export interface FallbackContactOption {
  channel: ContactChannel;
  label: string;
  href: string;
  preferred: boolean;
}

export interface ReachOutOptions {
  /** Always present — the Web-of-Trust reach-out needs no stored address. */
  primary: { channel: "wot"; label: string };
  /** Ordered: the peer's preferred_channel (if set and known) first, then
   * whichever of matrix/signal are on record, in a fixed fallback order. */
  fallbacks: FallbackContactOption[];
}

/** Pulls the bit of a requester string that identifies the person across
 * both formats network-access uses today: a bare email (query-infra
 * templates, e.g. "anna@example.org") and "Name <email>" (the legacy
 * /api/ask flow, ask.html). Falls back to the whole trimmed/lowercased
 * string when neither an angle-bracket email nor an @ sign is present, so a
 * non-email requester id still resolves consistently rather than throwing. */
export function peerKey(requester: string): string {
  const angled = requester.match(/<([^>]+)>/);
  const raw = angled ? angled[1]! : requester;
  return raw.trim().toLowerCase();
}

function matrixHref(value: string): string {
  if (value.startsWith("http")) return value;
  const mxid = value.startsWith("@") ? value : `@${value}`;
  return `https://matrix.to/#/${encodeURIComponent(mxid)}`;
}

function signalHref(value: string): string {
  if (value.startsWith("http")) return value;
  const digits = value.replace(/[^\d+]/g, "");
  return `https://signal.me/#p/${encodeURIComponent(digits)}`;
}

/** Builds the reach-out menu for one requester: Web-of-Trust always primary,
 * plus whatever Matrix/Signal channels the peer contact map has on file for
 * them, ordered by preferred_channel when set. Unknown requester (or a
 * requester with no channels on file) still gets the WoT primary — that path
 * never depends on this map. */
export function resolveContactOptions(map: PeerContactRecord[], requester: string): ReachOutOptions {
  const key = peerKey(requester);
  const record = map.find((r) => peerKey(r.requester) === key);

  const fallbacks: FallbackContactOption[] = [];
  if (record?.matrix) {
    fallbacks.push({
      channel: "matrix",
      label: "Matrix",
      href: matrixHref(record.matrix),
      preferred: record.preferred_channel === "matrix",
    });
  }
  if (record?.signal) {
    fallbacks.push({
      channel: "signal",
      label: "Signal",
      href: signalHref(record.signal),
      preferred: record.preferred_channel === "signal",
    });
  }
  fallbacks.sort((a, b) => Number(b.preferred) - Number(a.preferred));

  return {
    primary: { channel: "wot", label: "Contact over Web of Trust" },
    fallbacks,
  };
}

/** Builds the lookup for every requester seen in a batch (queries, red
 * flags, vault log) in one pass — the shape the owner-review UI actually
 * consumes from /api/inbox. */
export function resolveContactOptionsFor(
  map: PeerContactRecord[],
  requesters: Iterable<string>,
): Record<string, ReachOutOptions> {
  const out: Record<string, ReachOutOptions> = {};
  for (const requester of requesters) {
    if (requester in out) continue;
    out[requester] = resolveContactOptions(map, requester);
  }
  return out;
}
