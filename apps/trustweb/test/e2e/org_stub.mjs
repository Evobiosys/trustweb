/** In-memory stand-in for the /org routes (instructions-org-server.txt ROUTES) on 127.0.0.1:8961. node org_stub.mjs */
import http from 'node:http'
import { randomBytes } from 'node:crypto'

const orgs = new Map()
const L = { events: 3, invitees: 25 }
const send = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(o === undefined ? '' : JSON.stringify(o)) }

http.createServer((req, res) => {
  let text = ''
  req.on('data', (c) => { text += c })
  req.on('end', () => {
    let b = {}
    try { b = JSON.parse(text || '{}') } catch { return send(res, 400, { error: 'bad_json' }) }
    const o = orgs.get(b.org)
    const ok = o && o.secret === b.secret
    if (req.url === '/org') {
      if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 80) return send(res, 400, { error: 'bad_name' })
      const org = randomBytes(11).toString('hex'), secret = randomBytes(32).toString('base64url')
      orgs.set(org, { name: b.name, secret, events: new Map() })
      return send(res, 201, { org, secret, plan: 'free', limits: L })
    }
    if (req.url === '/org/hit') {
      for (const x of orgs.values()) { const e = x.events.get(b.event); if (e && e.counts[b.kind] !== undefined) e.counts[b.kind]++ }
      return send(res, 204)
    }
    if (!ok) return send(res, 403, { error: 'forbidden' })
    if (req.url === '/org/me') return send(res, 200, { name: o.name, plan: 'free', limits: L, events: [...o.events].map(([id, e]) => ({ id, ...e })) })
    if (req.url === '/org/event') {
      if (b.delete) { o.events.delete(b.id); return send(res, 204) }
      if (!Array.isArray(b.invitees) || !b.event?.name || !String(b.link).includes('#ev_host=')) return send(res, 400, { error: 'bad_request' })
      if (b.invitees.length > L.invitees) return send(res, 409, { error: 'limit_invitees' })
      const old = o.events.get(b.id)
      if (b.id && !old) return send(res, 403, { error: 'forbidden' })
      if (!old && o.events.size >= L.events) return send(res, 409, { error: 'limit_events' })
      const id = b.id ?? randomBytes(8).toString('hex')
      o.events.set(id, { event: b.event, link: b.link, invitees: b.invitees, counts: old?.counts ?? { opened: 0, joined: 0, tagged: 0 } })
      return send(res, old ? 200 : 201, old ? { id, counts: old.counts } : { id, counts: { opened: 0, joined: 0, tagged: 0 } })
    }
    send(res, 404, { error: 'not_found' })
  })
}).listen(8961, '127.0.0.1')
