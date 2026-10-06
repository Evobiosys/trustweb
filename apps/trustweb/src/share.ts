/**
 * Sending a meeting inside TrustWeb (owner 2026-10-06: "I should be able to
 * select the person that I'm sending it to from the people who I've already
 * connected with ... send him the transcript through the app").
 *
 * The meeting (who, where, when, the notes and the transcript) is packed on
 * this phone, encrypted with a fresh key (backup.ts, the same Swiss server as
 * the backups and hand-overs), and the other phone gets a short link whose
 * FRAGMENT carries the key: a browser never sends a fragment to a server, and
 * the relay only ever carries the sealed link. Two ways the link travels:
 *   - as a chat envelope to a connected peer (apps/demo's wire, text <= 500);
 *   - inside the Meet code after a meeting (#n=<notes>&k=<key>&t=<title>),
 *     so a person who scans it is connected AND has the notes and transcript.
 * Pure and DOM-free so the unit tests import the exact functions the app calls.
 */
import type { TranscriptLine } from './model'

export const SHARE_PARAM = 'share'
const KEY_KEY = 'k'
const KEY_TITLE = 't'
const TITLE_MAX = 80
const NOTES_MAX = 200
const TRANSCRIPT_MAX = 2000
const TEXT_MAX = 2000
const KEY_RE = /^TW1[A-Z0-9-]{20,80}$/i

export interface ShareLink {
  keyText: string
  title: string
}

/** What the pack holds: the meeting as the sender's phone had it, nothing about the sender's web. */
export interface MeetingPack {
  v: 1
  kind: 'meeting'
  from: string
  about: string
  where: string
  startedAt: number
  durationMs: number
  notes: string[]
  transcript: TranscriptLine[]
}

export function shareFragment(link: ShareLink): string {
  const q = new URLSearchParams()
  q.set(KEY_KEY, link.keyText)
  q.set(KEY_TITLE, link.title.slice(0, TITLE_MAX))
  return q.toString()
}

/** Reads the share parts of any fragment ("#..." or bare); null when there is no valid key in it. */
export function parseShareFragment(hash: string): ShareLink | null {
  const q = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const keyText = q.get(KEY_KEY) ?? ''
  if (!KEY_RE.test(keyText)) return null
  return { keyText, title: (q.get(KEY_TITLE) ?? '').slice(0, TITLE_MAX) }
}

/** The link a phone sends to a peer: the app, ?share=1 and the fragment. */
export function shareUrl(appUrl: string, link: ShareLink): string {
  return `${appUrl}?${SHARE_PARAM}=1#${shareFragment(link)}`
}

/** A chat text is one of our share links only when it points at this very app. */
export function parseShareText(appUrl: string, text: string): ShareLink | null {
  const prefix = `${appUrl}?${SHARE_PARAM}=1#`
  if (!text.startsWith(prefix) || text.length > TEXT_MAX) return null
  return parseShareFragment(text.slice(prefix.length))
}

function isTranscriptLine(v: unknown): v is TranscriptLine {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return typeof o.speaker === 'number' && typeof o.atMs === 'number' && typeof o.text === 'string'
}

/** Shape check for a pack that came off the server (untrusted bytes, even though only the key holder could write them). */
export function isMeetingPack(v: unknown): v is MeetingPack {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return o.v === 1 && o.kind === 'meeting'
    && typeof o.from === 'string' && typeof o.about === 'string' && typeof o.where === 'string'
    && typeof o.startedAt === 'number' && typeof o.durationMs === 'number'
    && Array.isArray(o.notes) && o.notes.length <= NOTES_MAX && o.notes.every((n) => typeof n === 'string')
    && Array.isArray(o.transcript) && o.transcript.length <= TRANSCRIPT_MAX && o.transcript.every(isTranscriptLine)
}
