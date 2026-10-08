/**
 * An in-browser stand-in for the connect service (services/trustweb-backup connect.mjs, contract section 10 of
 * DEVLOG/trustweb-wave-1733/services-api-contract.txt) for the e2e files of wave 6b: Playwright routes on a browser context answer
 * POST /connect, GET /c/<code> (302 to the stored link), POST /name and GET /who/<name> (302 to the stored link, see who()), with the same status
 * codes and shapes as the contract. Shared by every context it is installed on, so a second phone resolves what the first registered.
 * Nothing here listens on a port.
 */
import { randomBytes } from 'node:crypto'

const NAME_RE = /^[a-z0-9](?:[a-z0-9._-]{1,28})[a-z0-9]$/
const b64url = (n) => randomBytes(n).toString('base64url')

export function fakeConnectServer(origin) {
  const s = {
    codes: new Map(),
    names: new Map(),
    /** Reserved names, compared squashed (no . _ -), as the service does. */
    reserved: new Set(),
    /** "<code>:<name>" of every name the operator granted: locked against release and replacement from the app. */
    locked: new Set(),
    /** Add the `locked` array to every /name answer (E1's contract 10.9); false = the older pin shape without it. */
    answerLocked: true,
    posts: [],
    opens: [],
    /** Milliseconds every answer waits (a slow server). */
    delayMs: 0,
    /** The next n POST /connect answer this status instead of working (a broken server). */
    failNext: 0,
    failStatus: 500,
    /** GET /c/<code> and GET /who/<name> answer this status instead of the redirect (null: normal). */
    openStatus: null,
  }
  const wait = () => (s.delayMs ? new Promise((r) => setTimeout(r, s.delayMs)) : Promise.resolve())
  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

  async function connect(route) {
    const req = route.request()
    const body = JSON.parse(req.postData() || '{}')
    s.posts.push({ path: '/connect', body, headers: req.headers() })
    await wait()
    if (s.failNext > 0) { s.failNext -= 1; return json(route, s.failStatus, { error: 'server_error' }) }
    if (body.code === undefined) {
      const code = b64url(16)
      const secret = b64url(32)
      s.codes.set(code, { secret, url: body.url, name: '', aliases: [] })
      return json(route, 201, { code, secret, url: `${origin}/c/${code}` })
    }
    const have = s.codes.get(body.code)
    if (!have || have.secret !== body.secret) return json(route, 403, { error: 'forbidden', message: 'Not allowed.' })
    have.url = body.url
    return json(route, 200, { code: body.code, url: `${origin}/c/${body.code}` })
  }

  // POST /name, the wave 6e shape (services contract 10.9, pin P1 of wave 6e): READ, CLAIM (primary or alias), RELEASE, up to three names per
  // code, reserved names (answered 409 reserved) and names the operator granted (LOCKED: 409 name_locked on a release or a replacement).
  // Every 200 carries {name, aliases, locked} (E1's correction of the pin, contract 10.9): `locked` = the held names that are reserved right now.
  // `s.answerLocked = false` mimics the older pin answer without it.
  const squash = (n) => n.replace(/[._-]/g, '')
  const heldBy = (have) => [...(have.name ? [have.name] : []), ...have.aliases]
  const answer = (code, have) => ({ name: have.name, aliases: [...have.aliases], ...(s.answerLocked ? { locked: heldBy(have).filter((n) => s.locked.has(code + ':' + n)) } : {}) })
  const drop = (code, have, n) => {
    s.names.delete(n)
    s.locked.delete(code + ':' + n)
    if (have.name === n) { have.name = have.aliases.shift() ?? '' } else have.aliases = have.aliases.filter((x) => x !== n)
  }
  const refuse = (route, error, message) => json(route, 409, { error, message, field: 'name' })

  async function name(route) {
    const body = JSON.parse(route.request().postData() || '{}')
    s.posts.push({ path: '/name', body })
    await wait()
    const code = body.code
    const have = s.codes.get(code)
    if (!have || have.secret !== body.secret) return json(route, 403, { error: 'forbidden', message: 'Not allowed.' })
    const hasName = typeof body.name === 'string'
    const hasRelease = typeof body.release === 'string'
    // READ: code and secret only.
    if (!hasName && !hasRelease) return json(route, 200, answer(code, have))
    // RELEASE, or the legacy {name: ''} that frees the primary.
    if (hasRelease || (hasName && body.name === '')) {
      const target = hasRelease ? body.release : have.name
      if (!target || !heldBy(have).includes(target)) return json(route, 200, answer(code, have))
      if (s.locked.has(code + ':' + target)) return refuse(route, 'name_locked', 'That name is reserved for you; ask to change it.')
      drop(code, have, target)
      return json(route, 200, answer(code, have))
    }
    if (!NAME_RE.test(body.name)) return json(route, 400, { error: 'bad_request', field: 'name' })
    const n = body.name
    const asAlias = body.alias === true
    const held = heldBy(have)
    if (held.includes(n)) {
      // Claiming a held name again is idempotent; as the primary it PROMOTES an alias (the old primary becomes an alias when there is room).
      if (!asAlias && have.name !== n) {
        if (have.name && s.locked.has(code + ':' + have.name)) return refuse(route, 'name_locked', 'That name is reserved for you; ask to change it.')
        const old = have.name
        have.aliases = have.aliases.filter((x) => x !== n)
        have.name = n
        if (old) have.aliases.unshift(old)
      }
      return json(route, 200, answer(code, have))
    }
    if (!asAlias && have.name && s.locked.has(code + ':' + have.name)) return refuse(route, 'name_locked', 'That name is reserved for you; ask to change it.')
    if (s.reserved.has(squash(n))) return refuse(route, 'reserved', 'That name is reserved.')
    if (s.names.has(n) && s.names.get(n) !== code) return refuse(route, 'name_taken', 'That name is taken.')
    if (asAlias && held.length >= 3) return refuse(route, 'too_many_names', 'A code can hold up to 3 names.')
    if (asAlias && have.name) have.aliases.push(n)
    else {
      if (have.name) drop(code, have, have.name)
      have.name = n
    }
    s.names.set(n, code)
    return json(route, 200, answer(code, have))
  }

  const notFound = (route) => route.fulfill({ status: 404, contentType: 'text/html', body: '<p>This link is not available.</p>' })

  async function open(route) {
    const url = new URL(route.request().url())
    const code = url.pathname.slice('/c/'.length)
    s.opens.push({ path: url.pathname })
    await wait()
    if (s.openStatus) return route.fulfill({ status: s.openStatus, body: 'x' })
    const have = s.codes.get(code)
    return have ? route.fulfill({ status: 302, headers: { Location: have.url, 'Cache-Control': 'no-store' } }) : notFound(route)
  }

  async function who(route) {
    const url = new URL(route.request().url())
    const wanted = decodeURIComponent(url.pathname.slice('/who/'.length))
    s.opens.push({ path: url.pathname })
    await wait()
    if (s.openStatus) return route.fulfill({ status: s.openStatus, body: 'x' })
    const code = s.names.get(wanted)
    // The real server answers /who/<name> with a 302 to /c/<code> and that with a 302 to the link. Playwright does not route the second hop of a
    // redirect again (the app's catch-all would answer /c/<code> with the page), so the stub collapses the two into one redirect to the link.
    const stored = code ? s.codes.get(code) : undefined
    return stored ? route.fulfill({ status: 302, headers: { Location: stored.url, 'Cache-Control': 'no-store' } }) : notFound(route)
  }

  s.install = async (ctx) => {
    await ctx.route(origin + '/connect', connect)
    await ctx.route(origin + '/name', name)
    await ctx.route(origin + '/c/*', open)
    await ctx.route(origin + '/who/*', who)
  }
  /** The operator's grant (POST /admin/name on the real service, loopback only): a name on an existing code, locked. */
  s.grant = (code, granted, { alias = false } = {}) => {
    const have = s.codes.get(code)
    if (!have) throw new Error('unknown code')
    s.reserved.add(granted.replace(/[._-]/g, ''))
    if (alias && have.name) have.aliases.push(granted)
    else { if (have.name) have.aliases.unshift(have.name); have.name = granted }
    s.names.set(granted, code)
    s.locked.add(code + ':' + granted)
  }
  s.codeOf = (url) => [...s.codes.entries()].find(([, v]) => v.url === url)?.[0]
  return s
}
