// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Short aliases for share links (wave 32; app side: apps/trustweb/src/short_alias.ts).
//
//   POST /s {code, secret, token, did, succession?}   register token -> did (201 new, 200 changed). Authenticated by the secret of a connect code.
//   GET  /s/<token>                                   302 to https://<request Host>/?alias=<token>; with Accept: application/json: 200 {did, succession}
//
// The did stays the root of trust: the server only maps a token to it and carries the signed succession record, which the app verifies itself.
// NO ORACLE: an unknown token, a bad shape and a foreign Host answer the same 404 page; a token held by another code answers like a wrong secret (403).
// Both routes share the budgets of /name and /who (connect.mjs receive / readGate). The store keeps no secret: {token: {code, did, succession?}} in a 0600 file.
import fs from 'node:fs/promises'
import { CODE_RE } from './connect_names.mjs'
import { SECRET_RE } from './connect_store.mjs'
import { jsonError, sendJson } from './http_util.mjs'
import { appHostOf, onHost } from './connect.mjs'
import { notFoundPage } from './links.mjs'

const TOKEN_RE = /^[a-z2-7]{10}$/
const MAX_DID = 512
const MAX_PER_CODE = 3
const MAX_TOTAL = 100_000

const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max
const validSuccession = (s) => s !== null && typeof s === 'object' && text(s.old, MAX_DID) && text(s.new, MAX_DID) && Number.isFinite(s.at) && text(s.sig, 256)

/** Opens the store at `file` (created on the first write). Resolves a Map token -> {code, did, succession?}; a file that does not parse starts empty. */
export async function openAliasStore(file) {
  let held = {}
  try {
    held = JSON.parse(await fs.readFile(file, 'utf8')).aliases ?? {}
  } catch { /* first start, or unreadable: empty */ }
  const map = new Map(Object.entries(held).filter(([t, e]) => TOKEN_RE.test(t) && e && typeof e.code === 'string' && typeof e.did === 'string'))
  const save = async () => {
    const tmp = `${file}.tmp`
    await fs.writeFile(tmp, JSON.stringify({ v: 1, aliases: Object.fromEntries(map) }), { mode: 0o600 })
    await fs.rename(tmp, file)
  }
  return { map, save }
}

export function createShortAliases({ cfg, connectStore, gate, aliasStore }) {
  const { map, save } = aliasStore
  let chain = Promise.resolve()
  const persist = () => (chain = chain.then(save, save))

  /** POST /s. Returns the status it answered. */
  async function register(req, res) {
    const got = await gate.receive(req, res)
    if (got.body === undefined) return got.status
    const { code, secret, token, did, succession } = got.body
    if (typeof code !== 'string' || !CODE_RE.test(code)) return jsonError(res, 400, 'bad_request', { field: 'code' })
    if (typeof secret !== 'string' || !SECRET_RE.test(secret)) return jsonError(res, 400, 'bad_request', { field: 'secret' })
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return jsonError(res, 400, 'bad_request', { field: 'token' })
    if (!text(did, MAX_DID)) return jsonError(res, 400, 'bad_request', { field: 'did' })
    if (succession !== undefined && !validSuccession(succession)) return jsonError(res, 400, 'bad_request', { field: 'succession' })
    if ((await connectStore.read(code, secret)).kind === 'forbidden') return jsonError(res, 403, 'forbidden')
    const held = map.get(token)
    if (held !== undefined && held.code !== code) return jsonError(res, 403, 'forbidden')
    if (held === undefined) {
      if (map.size >= MAX_TOTAL) return jsonError(res, 503, 'full')
      if ([...map.values()].filter((e) => e.code === code).length >= MAX_PER_CODE) return jsonError(res, 409, 'too_many_aliases')
    }
    map.set(token, { code, did, ...(succession === undefined ? {} : { succession }) })
    try {
      await persist()
    } catch {
      return jsonError(res, 500, 'server_error')
    }
    sendJson(res, held === undefined ? 201 : 200, { token })
    return held === undefined ? 201 : 200
  }

  /** GET|HEAD /s/<token>. pathname is the request path without its query. Returns the status it answered. */
  function open(req, res, pathname) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow')
    const gated = gate.readGate(req, res)
    if (gated !== null) return gated
    const host = appHostOf(req, cfg.linkHosts)
    const token = pathname.slice('/s/'.length)
    const entry = host === null || !TOKEN_RE.test(token) ? undefined : map.get(token)
    if (entry === undefined) return notFoundPage(res)
    if (String(req.headers.accept ?? '').includes('application/json')) {
      res.setHeader('Cache-Control', 'no-store')
      sendJson(res, 200, { did: entry.did, succession: entry.succession ?? null })
      return 200
    }
    res.writeHead(302, { Location: onHost(`https://${cfg.linkHosts[0]}/?alias=${token}`, host), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' })
    res.end()
    return 302
  }

  return { register, open, flush: () => chain }
}
