// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Dev only: the answer of GET /__tw/matches?from=<n> (lines n.. of dev-matches.jsonl next to the dev record, and dev-matches-status.json).
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const loopback = (h) => /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(h.host ?? '') && !h.origin

export function matchesReply(dir, url, headers) {
  if (!loopback(headers)) return { code: 403, body: null }
  const from = Math.max(0, Number(new URL(url, 'http://x').searchParams.get('from')) || 0)
  const file = path.join(dir, 'dev-matches.jsonl')
  const all = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []
  const sFile = path.join(dir, 'dev-matches-status.json')
  let status = null
  try { status = existsSync(sFile) ? JSON.parse(readFileSync(sFile, 'utf8')) : null } catch { /* half-written */ }
  return { code: 200, body: { lines: all.slice(from), next: all.length, status } }
}
