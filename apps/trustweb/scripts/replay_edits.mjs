// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// node apps/trustweb/scripts/replay_edits.mjs <edits.jsonl> <base-record.json> <out.json>
// Rebuilds a record from a base record plus the edit stream (see EDIT-STREAM.txt). Lines are played in file order; the base is never written.
import { readFileSync, writeFileSync } from 'node:fs'
import { applyEdit } from '../src/record_diff.ts'

export function replay(base, jsonl) {
  return jsonl.split('\n').filter((l) => l.trim()).reduce((rec, line) => applyEdit(rec, JSON.parse(line)), base)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [edits, base, out] = process.argv.slice(2)
  if (!edits || !base || !out) { console.error('usage: replay_edits.mjs <edits.jsonl> <base-record.json> <out.json>'); process.exit(2) }
  const rec = replay(JSON.parse(readFileSync(base, 'utf8')), readFileSync(edits, 'utf8'))
  writeFileSync(out, JSON.stringify(rec))
  console.log(`replayed onto ${base}: ${rec.people.length} people -> ${out}`)
}
