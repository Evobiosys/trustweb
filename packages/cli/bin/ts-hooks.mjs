// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Runs the TypeScript sources (this package's and the share sink's in apps/trustweb) on plain Node, with no build step and no
 * dependency: extensionless relative imports resolve to `.ts`, and `.ts` files go through Node's own type transform (enums
 * included). Imported for its side effect, by bin/trustweb.mjs and by the test run (`node --import`).
 */
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Node marks the type transform experimental; the CLI's output stays clean of that one notice, every other warning still shows.
const emit = process.emitWarning
process.emitWarning = (warning, ...rest) => {
  const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type
  if (type === 'ExperimentalWarning' && String(warning).includes('stripTypeScriptTypes')) return
  return emit.call(process, warning, ...rest)
}

const relative = (spec) => spec.startsWith('./') || spec.startsWith('../')

registerHooks({
  resolve(spec, context, next) {
    try {
      return next(spec, context)
    } catch (err) {
      if (relative(spec) && !/\.[cm]?[jt]s$/.test(spec)) return next(`${spec}.ts`, context)
      throw err
    }
  },
  load(url, context, next) {
    if (!url.startsWith('file:') || !url.endsWith('.ts')) return next(url, context)
    const source = stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform', sourceMap: true, sourceUrl: url })
    return { format: 'module', source, shortCircuit: true }
  },
})
