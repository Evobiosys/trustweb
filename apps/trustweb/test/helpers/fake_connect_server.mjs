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
    posts: [],
    opens: [],
    /** Milliseconds every answer waits (a slow server). */
    delayMs: 0,
    /** The next n POST /connect answer this status instead of working (a broken server). */
    failNext: 0,
    failStatus: 500,
    /** Resolve answers this status for GET /c/<code> instead of the redirect (null: normal). */
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
      s.codes.set(code, { secret, url: body.url, name: '' })
      return json(route, 201, { code, secret, url: `${origin}/c/${code}` })
    }
    const have = s.codes.get(body.code)
    if (!have || have.secret !== body.secret) return json(route, 403, { error: 'forbidden', message: 'Not allowed.' })
    have.url = body.url
    return json(route, 200, { code: body.code, url: `${origin}/c/${body.code}` })
  }

  async function name(route) {
    const body = JSON.parse(route.request().postData() || '{}')
    s.posts.push({ path: '/name', body })
    await wait()
    const have = s.codes.get(body.code)
    if (!have || have.secret !== body.secret) return json(route, 403, { error: 'forbidden', message: 'Not allowed.' })
    if (body.name === '') { s.names.delete(have.name); have.name = ''; return json(route, 200, { name: '' }) }
    if (!NAME_RE.test(body.name)) return json(route, 400, { error: 'bad_request', field: 'name' })
    if (s.names.has(body.name) && s.names.get(body.name) !== body.code) return json(route, 409, { error: 'name_taken', field: 'name' })
    if (have.name) s.names.delete(have.name)
    have.name = body.name
    s.names.set(body.name, body.code)
    return json(route, 200, { name: body.name })
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
  s.codeOf = (url) => [...s.codes.entries()].find(([, v]) => v.url === url)?.[0]
  return s
}
