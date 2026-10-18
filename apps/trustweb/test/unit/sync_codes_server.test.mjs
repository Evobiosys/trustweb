/**
 * F19: the app's REAL requests (names_sync bodyOf(move), the renew request, the touch) against the REAL service (services/trustweb-backup connect.mjs):
 * its parser, its 30-day move rule, its lookalike check, its secret rotation. Also F10: an old server answers a move as a plain READ -> no change.
 */
import { HOST as SERVER_HOST, withServer } from '../../../../services/trustweb-backup/test/helpers.mjs'
import { BASE, claim, connect } from '../../../../services/trustweb-backup/test/connect_helpers.mjs'
import { callNames } from '../../src/names_sync.ts'
import { moveHere, rotateCodes } from '../../src/sync_codes.ts'
import { createConnectKeeper } from '../../src/connect_code.ts'

const ORIGIN = 'https://app.trustintheweb.org'
const APP_HOST = new URL(ORIGIN).host
const longUrl = (n) => `${ORIGIN}/?connect=did%3Apeer%3A2.Ez6LSdevice${n}&id=p-${n}`
const state = (over = {}) => ({ v: 1, me: { name: 'J', displayName: 'J' }, people: [], peers: [], inventory: [], log: [], meetings: [], ...over })

/** The app's fetch, pointed at a local server instead of the public host. */
const viaPort = (port) => async (input, init = {}) => {
  const url = new URL(input)
  const { default: http } = await import('node:http')
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: init.method ?? 'GET', path: url.pathname + url.search, headers: { Host: SERVER_HOST, ...(init.headers ?? {}) } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode, ok: res.statusCode < 300, json: async () => JSON.parse(text) })
      })
    })
    req.on('error', reject)
    req.end(init.body)
  })
}

const options = { ...BASE, linkHosts: [APP_HOST] }
async function twoCodes(port) {
  const mk = async (n, names) => {
    const r = (await connect(port, { url: longUrl(n) })).json
    for (const [i, name] of names.entries()) await claim(port, { ...r, name, alias: i > 0 })
    return { ...r, url: longUrl(n), updatedAt: 1, ...(names[0] ? { name: names[0] } : {}), ...(names.length > 1 ? { aliases: names.slice(1) } : {}) }
  }
  return { a: await mk(1, ['ada']), b: await mk(2, ['bob', 'bo2']) }
}

describe('the app against the real service', () => {
  it('a move: the real parser takes bodyOf(move); the 30-day rule and the lookalike check hold; the name travels with its lock rules', async () => {
    await withServer(0, options, async ({ srv }) => {
      const { a, b } = await twoCodes(srv.port)
      const s = state({ connectCode: a, otherCodes: [b] })
      const deps = { origin: ORIGIN, fetch: viaPort(srv.port), now: () => Date.now(), state: () => s, save: () => {}, log: () => {} }
      const out = await moveHere(deps, 'bo2', s.otherCodes[0])
      expect(out.ok).toBe(true)
      expect([s.connectCode.name, ...(s.connectCode.aliases ?? [])]).toEqual(['ada', 'bo2'])
      // the same name again within 30 days: the service says name_moved
      const back = await callNames(deps, s.otherCodes[0], { kind: 'move', name: 'bo2', from: { code: a.code, secret: a.secret }, as: 'alias' })
      expect(back).toMatchObject({ ok: false, error: 'name-moved' })
      // a lookalike of a name another code holds is refused (name_taken); `from` is excluded from that check
      const c = (await connect(srv.port, { url: longUrl(3) })).json
      await claim(srv.port, { ...c, name: 'cy0' })
      const d = (await connect(srv.port, { url: longUrl(4) })).json
      await claim(srv.port, { ...d, name: 'cyo' }).then((r) => expect(r.status).toBe(409))
    })
  })
  it('the renew request: the real service answers a NEW secret and the old one is dead', async () => {
    await withServer(0, options, async ({ srv }) => {
      const { a } = await twoCodes(srv.port)
      const s = state({ connectCode: a })
      const deps = { origin: ORIGIN, fetch: viaPort(srv.port), now: () => 77, state: () => s, save: () => {}, log: () => {} }
      await rotateCodes(deps)
      expect(s.connectCode.secret).not.toBe(a.secret)
      expect(s.connectCode.secretAt).toBe(77)
      expect((await callNames(deps, { ...a }, { kind: 'read' })).ok).toBe(false)
      expect((await callNames(deps, s.connectCode, { kind: 'read' })).ok).toBe(true)
    })
  })
  it('the keeper touch is a plain GET the service accepts (read-only, no write)', async () => {
    await withServer(0, options, async ({ srv }) => {
      const { a } = await twoCodes(srv.port)
      let rec = { ...a, updatedAt: 1000 }
      const keeper = createConnectKeeper({ origin: ORIGIN, fetch: viaPort(srv.port), now: () => 1000 + 40 * 86_400_000, load: () => rec, store: (r) => { rec = r } })
      expect(await keeper.ensure(a.url)).toBe(true)
      expect(rec).toMatchObject({ code: a.code, url: a.url, updatedAt: 1000, touchedAt: 1000 + 40 * 86_400_000 })
    })
  })
  it('F10: an OLD server ignores `move` and answers a plain READ: the client sees no change and reports a server error', async () => {
    const names = { name: 'ada', aliases: [], locked: [] }
    const old = async () => ({ status: 200, ok: true, json: async () => names })
    const rec = { code: 'A'.repeat(22), secret: 'A'.repeat(43), url: longUrl(1), updatedAt: 1, name: 'ada' }
    const out = await callNames({ origin: ORIGIN, fetch: old, now: () => 1 }, rec, { kind: 'move', name: 'bob', from: { code: 'B'.repeat(22), secret: 'B'.repeat(43) }, as: 'alias' })
    expect(out).toEqual({ ok: false, error: 'server' })
  })
})
