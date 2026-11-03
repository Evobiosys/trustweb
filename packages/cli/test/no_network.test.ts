// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * The CLI makes no network calls. Two proofs: (a) static: no CLI file imports a module that can reach the network or start
 * another process, and the app files it reuses import nothing but each other (plus types); (b) dynamic: with the network
 * entry points replaced by tripwires, a whole session (init, export, import, log, help) runs and no tripwire fires.
 * The built-in modules are reached through process.getBuiltinModule so this file itself imports none of them.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walk } from '../src/cli.ts'
import { ROOT } from '../src/main.ts'
import { Cli, seeded } from './helpers/run.ts'

const CLI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = join(CLI_ROOT, '..', '..')
const NETWORK_MODULES = ['http', 'https', 'net', 'dns', 'dgram', 'tls', 'http2', 'child_process', 'worker_threads', 'inspector']

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* files(p)
    else if (/\.(ts|mts|mjs|js)$/.test(name)) yield p
  }
}

/** Every module specifier a file names: static imports and re-exports (one or many lines), dynamic import(), require(). */
function specifiers(text: string): { spec: string; typeOnly: boolean }[] {
  const out: { spec: string; typeOnly: boolean }[] = []
  for (const m of text.matchAll(/^\s*(import|export)\s+(type\s+)?([\w\s{},*$]*?)\s*from\s*['"]([^'"]+)['"]/gm)) out.push({ spec: m[4], typeOnly: Boolean(m[2]) })
  for (const m of text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) out.push({ spec: m[1], typeOnly: false })
  for (const m of text.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push({ spec: m[1], typeOnly: false })
  return out
}

const bareName = (spec: string): string => spec.replace(/^node:/, '').split('/')[0]

describe('no network: static', () => {
  it('no file of the CLI (src, bin, scripts) imports a network or process module, or calls fetch', () => {
    const seen: string[] = []
    for (const dir of ['src', 'bin', 'scripts']) {
      for (const file of files(join(CLI_ROOT, dir))) {
        const text = readFileSync(file, 'utf8')
        const rel = relative(CLI_ROOT, file)
        seen.push(rel)
        for (const { spec } of specifiers(text)) assert.ok(!NETWORK_MODULES.includes(bareName(spec)), `${rel} imports ${spec}`)
        assert.ok(!/\bfetch\s*\(/.test(text), `${rel} calls fetch`)
        assert.ok(!/getBuiltinModule\s*\(/.test(text), `${rel} reaches a built-in module around the imports`)
      }
    }
    assert.ok(seen.includes(join('src', 'sink.ts')) && seen.includes(join('bin', 'trustweb.mjs')), 'the walk found the CLI')
  })
  it('the app files the CLI reaches import nothing but each other, plus types', () => {
    const shareSink = join(REPO, 'apps', 'trustweb', 'src', 'share_sink')
    const reached = [...readdirSync(shareSink).filter((n) => n.endsWith('.ts')).map((n) => join(shareSink, n)), join(REPO, 'apps', 'trustweb', 'src', 'model.ts')]
    const allowed = new Set(reached.map((f) => f.replace(/\.ts$/, '')))
    for (const file of reached) {
      const rel = relative(REPO, file)
      const text = readFileSync(file, 'utf8')
      for (const { spec, typeOnly } of specifiers(text)) {
        if (typeOnly) continue
        assert.ok(spec.startsWith('.'), `${rel}: a value import of a package (${spec})`)
        const target = resolve(dirname(file), spec).replace(/\.ts$/, '')
        assert.ok(allowed.has(target), `${rel}: a value import outside the share sink and the model (${spec})`)
      }
      assert.ok(!/\bfetch\s*\(/.test(text), `${rel} calls fetch`)
    }
  })
  it('sink.ts is the only CLI file that imports the app', () => {
    for (const file of files(join(CLI_ROOT, 'src'))) {
      const rel = relative(CLI_ROOT, file)
      const reachesApp = specifiers(readFileSync(file, 'utf8')).some(({ spec }) => spec.includes('apps/'))
      assert.equal(reachesApp, rel === join('src', 'sink.ts'), rel)
    }
  })
})

type Patchable = Record<string, unknown>

describe('no network: dynamic', () => {
  it('a whole session runs with every network entry point replaced by a tripwire, and none fires', async () => {
    const calls: string[] = []
    const restore: (() => void)[] = []
    const trip = (holder: Patchable, key: string, name: string): void => {
      const original = holder[key]
      if (typeof original !== 'function') return
      holder[key] = function tripwire(): never {
        calls.push(name)
        throw new Error(`network call: ${name}`)
      }
      restore.push(() => { holder[key] = original })
    }
    const builtin = (name: string): Patchable => process.getBuiltinModule(`node:${name}`) as Patchable
    trip(globalThis as unknown as Patchable, 'fetch', 'globalThis.fetch')
    const net = builtin('net')
    trip((net.Socket as { prototype: Patchable }).prototype, 'connect', 'net.Socket.prototype.connect')
    for (const k of ['connect', 'createConnection', 'createServer']) trip(net, k, `net.${k}`)
    const dns = builtin('dns')
    for (const k of ['lookup', 'resolve', 'resolve4', 'resolve6']) trip(dns, k, `dns.${k}`)
    for (const k of ['lookup', 'resolve']) trip(dns.promises as Patchable, k, `dns.promises.${k}`)
    for (const k of ['request', 'get']) {
      trip(builtin('http'), k, `http.${k}`)
      trip(builtin('https'), k, `https.${k}`)
    }
    trip(builtin('tls'), 'connect', 'tls.connect')
    trip(builtin('http2'), 'connect', 'http2.connect')
    trip(builtin('dgram'), 'createSocket', 'dgram.createSocket')
    const cp = builtin('child_process')
    for (const k of ['spawn', 'exec', 'execFile', 'fork', 'spawnSync', 'execSync', 'execFileSync']) trip(cp, k, `child_process.${k}`)
    assert.ok(restore.length >= 20, `tripwires set: ${restore.length}`)
    try {
      const a = await seeded()
      const fresh = new Cli()
      const codes: [string, number][] = []
      const run = async (cli: Cli, ...argv: string[]): Promise<void> => { codes.push([argv.join(' '), (await cli.run(...argv)).code]) }
      await run(a, 'export')
      await run(a, 'export', '--format', 'jsonl', '--effective')
      await run(a, 'export', '--format', 'markdown')
      await run(a, 'export', '--out', 'web.json')
      await run(fresh, 'import', join(a.dir, 'web.json'))
      await run(a, 'import', join(a.dir, 'web.json'), '--merge')
      await run(a, 'import', join(a.dir, 'web.json'), '--replace', '--dry-run')
      await run(a, 'log')
      await run(fresh, 'log', '--json')
      for (const { path } of walk(ROOT)) await run(a, ...path, '--help')
      await run(a, '--version')
      assert.deepEqual(codes.filter(([, c]) => c !== 0), [], 'every command succeeded')
      assert.ok(codes.length > 10)
    } finally {
      for (const undo of restore.reverse()) undo()
    }
    assert.deepEqual(calls, [])
    assert.equal(typeof globalThis.fetch, 'function', 'restored')
  })
})
