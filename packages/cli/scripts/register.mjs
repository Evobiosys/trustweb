// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Module hooks that let plain Node run the CLI and the app modules it reuses, with nothing installed:
 *   - resolve: an extensionless relative import (apps/trustweb/src writes `./zones`, `../model`) finds its .ts file;
 *   - load: a .ts file is turned into JavaScript by Node's own stripper in transform mode (enums survive; the model
 *     and the share sink use them). Source maps keep stack traces on the TypeScript lines.
 * Used by bin/trustweb.mjs and by the test run (`node --import ./scripts/register.mjs --test`). Node >= 22.13.
 */
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const TS = /\.[cm]?ts$/
const HAS_EXT = /\.[cm]?[jt]sx?$|\.json$/

/** Node prints "stripTypeScriptTypes is experimental" once per process; the CLI's user did not ask for that line. Only that warning is held back, only during the call. */
function quietly(fn) {
  const emit = process.emitWarning
  process.emitWarning = (warning, ...rest) => {
    const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type ?? (warning && warning.name)
    if (type !== 'ExperimentalWarning') emit.call(process, warning, ...rest)
  }
  try {
    return fn()
  } finally {
    process.emitWarning = emit
  }
}

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context)
    } catch (e) {
      if (specifier.startsWith('.') && !HAS_EXT.test(specifier) && context.parentURL) {
        const base = fileURLToPath(new URL(specifier, context.parentURL))
        for (const ext of ['.ts', '.mts']) {
          if (existsSync(base + ext)) return { url: pathToFileURL(base + ext).href, shortCircuit: true }
        }
      }
      throw e
    }
  },
  load(url, context, next) {
    if (!TS.test(url)) return next(url, context)
    const source = quietly(() => stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform', sourceMap: true, sourceUrl: url }))
    return { format: 'module', source, shortCircuit: true }
  },
})
