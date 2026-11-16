// Tana #person export -> bare AppState JSON for the CRM's "Import a TrustWeb export" (and TW_CRM_RECORD).
// File-only, no network. Input is untrusted text: parsed with JSON.parse and regexes, never evaluated.
//   node scripts/tana_persons_to_record.mjs <persons-index.json> <persons-nodes.json> <out.json> [person-schema.md]
// Next to the nodes file the converter also reads person-schema.md, workspaces.json (persons outside the first workspace get a
// "workspace: <name>" tag line) and, when present, environment-index-all.json + environment-nodes.json + environment-schema.md
// (written as record.environments), intending.json (scripts/tana_intending.mjs: { id: { n, since } }, newer than the cached nodes) and first-met.json (scripts/tana_first_met.mjs) for metAt and a context line. Field lines become person.fields (see src/fields.ts), plain bullets note lines.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { parseSchema } from './tana_schema_to_fields.mjs'
export { convert, workspaceName, HIDE } from './tana_convert.mjs'
import { convert } from './tana_convert.mjs'

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [indexPath, nodesPath, outPath, schemaArg] = process.argv.slice(2)
  if (!outPath) {
    console.error('usage: tana_persons_to_record.mjs <persons-index.json> <persons-nodes.json> <out.json> [person-schema.md]')
    process.exit(2)
  }
  const dir = path.dirname(nodesPath)
  const read = (f) => readFileSync(path.join(dir, f), 'utf8')
  const has = (f) => existsSync(path.join(dir, f))
  const env = has('environment-index-all.json')
    ? { index: JSON.parse(read('environment-index-all.json')), nodes: JSON.parse(read('environment-nodes.json')), schema: parseSchema(read('environment-schema.md')) }
    : undefined
  const { record, stats } = convert(
    JSON.parse(readFileSync(indexPath, 'utf8')), JSON.parse(readFileSync(nodesPath, 'utf8')),
    parseSchema(schemaArg ? readFileSync(schemaArg, 'utf8') : read('person-schema.md')),
    has('workspaces.json') ? JSON.parse(read('workspaces.json')) : [], env,
    has('first-met.json') ? JSON.parse(read('first-met.json')) : {},
    new Set(has('hidden.json') ? JSON.parse(read('hidden.json')) : []),
    has('intending.json') ? JSON.parse(read('intending.json')) : {},
    has('ring-suggestions.json') ? JSON.parse(read('ring-suggestions.json')) : {},
    new Date().toISOString().slice(0, 10),
  )
  writeFileSync(outPath, JSON.stringify(record))
  console.log(`persons ${stats.persons}, environments ${stats.environments}, note lines ${stats.lines}, persons without any field ${stats.withoutFields}, hidden ${stats.hidden}, blank ${stats.blank}`)
}
