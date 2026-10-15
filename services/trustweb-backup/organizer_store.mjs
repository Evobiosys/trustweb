// Disk layer of the organizer accounts (wave 8; contract: DEVLOG/trustweb-wave-1733/services-api-contract.txt, section 11).
//
//   <file>  {"version":1,"orgs":{"<org>":{name, secretHash, plan, created, updated, events:{"<id>":{event, link, invitees:[], counts:{opened,joined,tagged}, created, updated}}}}}
//   mode 0600, rewritten atomically (temp file, fsync, rename), writes serialised through one promise queue.
//
// PRIVACY: the file holds what the ORGANIZER already has (their event fields and invitee e-mails) plus aggregate counters. Never an attendee's identity, web,
// tags or notes: `hit` takes an event id and a kind and nothing else, and keeps no request data.
//
// Like connect_store: everything lives in memory; each mutation (secret check, limit check, change) is ONE synchronous block with no await, only the file write
// is awaited and a failed write rolls the change back. Only sha256(secret) is kept, compared in constant time; an unknown org is compared against a dummy.
//
// LOGGING: none. No logger, nothing on stdout/stderr.

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { CODE_RE } from './connect_names.mjs'
import { hashMatches, hashSecret, newCode } from './connect_store.mjs'

export const PLANS = Object.freeze(['free', 'hosted'])
export const KINDS = Object.freeze(['opened', 'joined', 'tagged'])
export const EVENT_ID_RE = /^[0-9a-f]{16}$/
const HASH_RE = /^[0-9a-f]{64}$/

/** The limits of `plan` ({events, invitees}) under `cfg`. */
export const limitsFor = (cfg, plan) =>
  plan === 'hosted' ? { events: cfg.orgHostedMaxEvents, invitees: cfg.orgHostedMaxInvitees } : { events: cfg.orgMaxEvents, invitees: cfg.orgMaxInvitees }

const newEventId = () => crypto.randomBytes(8).toString('hex')
const isCounts = (c) => c !== null && typeof c === 'object' && KINDS.every((k) => Number.isInteger(c[k]) && c[k] >= 0)
const isEvent = (id, e) => EVENT_ID_RE.test(id) && e !== null && typeof e === 'object' && typeof e.link === 'string' && Array.isArray(e.invitees) && isCounts(e.counts)
const isOrg = (org, o) =>
  CODE_RE.test(org) && o !== null && typeof o === 'object' && typeof o.name === 'string' && HASH_RE.test(o.secretHash ?? '') && PLANS.includes(o.plan) && o.events !== null && typeof o.events === 'object'

/**
 * Opens (or creates) the store; `recovered` is true when the file did not parse and was moved aside to <file>.unreadable.
 * Rejects when the file cannot be read or written: the caller treats that as "off". `limitsOf(plan)` = {events, invitees}.
 */
export async function createOrgStore({ file, max, limitsOf, now = Date.now }) {
  const orgs = new Map() // org -> entry of the file shape
  const eventOrg = new Map() // event id -> org
  let recovered = false
  let chain = Promise.resolve()
  let running = false
  let again = false

  async function load() {
    let text
    try {
      text = await fs.readFile(file, 'utf8')
    } catch (err) {
      if (err.code === 'ENOENT') return
      throw err
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
    if (parsed === null || typeof parsed !== 'object' || parsed.orgs === null || typeof parsed.orgs !== 'object') {
      recovered = true
      await fs.rename(file, `${file}.unreadable`)
      return
    }
    for (const [org, o] of Object.entries(parsed.orgs)) {
      if (!isOrg(org, o)) continue
      const events = Object.fromEntries(Object.entries(o.events).filter(([id, e]) => isEvent(id, e)))
      orgs.set(org, { ...o, events })
      for (const id of Object.keys(events)) eventOrg.set(id, org)
    }
  }

  /** Write + fsync + rename of the whole map. Writes run one after the other; each snapshots the map when it starts. */
  function persist() {
    const run = async () => {
      const tmp = `${file}.tmp`
      const handle = await fs.open(tmp, 'w', 0o600)
      try {
        await handle.chmod(0o600)
        await handle.writeFile(JSON.stringify({ version: 1, orgs: Object.fromEntries(orgs) }))
        await handle.sync()
      } finally {
        await handle.close()
      }
      await fs.rename(tmp, file)
    }
    const next = chain.then(run, run)
    chain = next.catch(() => undefined)
    return next
  }

  /** A counter write nobody waits for; writes that arrive while one runs collapse into one more. */
  function background() {
    if (running) {
      again = true
      return
    }
    running = true
    persist()
      .catch(() => undefined)
      .finally(() => {
        running = false
        if (again) {
          again = false
          background()
        }
      })
  }

  /** Persists after a synchronous change; on failure runs `rollback` and rethrows. */
  async function commit(rollback) {
    try {
      await persist()
    } catch (err) {
      rollback()
      throw err
    }
  }

  /** The org entry when `secret` opens it, else undefined (unknown and wrong alike; always hashes and compares). */
  function opened(org, secret) {
    const entry = orgs.get(org)
    return hashMatches(entry?.secretHash, secret) ? entry : undefined
  }

  function freshEventId() {
    let id = newEventId()
    while (eventOrg.has(id)) id = newEventId()
    return id
  }

  await load()
  await persist() // proves the file can be written (else the caller turns the feature off) and leaves it at 0600

  return {
    recovered,
    size: () => orgs.size,

    /** A new organizer on plan free. Resolves {kind: 'created', org} or {kind: 'full'}. Rejects when the file cannot be written (rolled back). */
    async create(name, secret) {
      if (orgs.size >= max) return { kind: 'full' }
      let org = newCode()
      while (orgs.has(org)) org = newCode()
      const t = now()
      orgs.set(org, { name, secretHash: hashSecret(secret).toString('hex'), plan: 'free', created: t, updated: t, events: {} })
      await commit(() => orgs.delete(org))
      return { kind: 'created', org }
    },

    /** The organizer's own data. Resolves {kind: 'ok', name, plan, events: [{id, ...}]} (oldest first) or {kind: 'forbidden'}. */
    async me(org, secret) {
      const entry = opened(org, secret)
      if (entry === undefined) return { kind: 'forbidden' }
      const events = Object.entries(entry.events).map(([id, e]) => ({ id, ...e }))
      return { kind: 'ok', name: entry.name, plan: entry.plan, events: events.sort((a, b) => a.created - b.created) }
    },

    /**
     * Creates an event, or updates the own event `id` (counts kept). Resolves {kind: 'created' | 'updated', id, counts},
     * {kind: 'forbidden'}, {kind: 'not_found'} (an id that is not this org's), {kind: 'limit_events'} or {kind: 'limit_invitees'}.
     */
    async saveEvent(org, secret, { id, event, link, invitees }) {
      const entry = opened(org, secret)
      if (entry === undefined) return { kind: 'forbidden' }
      const old = id === undefined ? undefined : entry.events[id]
      if (id !== undefined && old === undefined) return { kind: 'not_found' }
      const limits = limitsOf(entry.plan)
      if (invitees.length > limits.invitees) return { kind: 'limit_invitees' }
      if (old === undefined && Object.keys(entry.events).length >= limits.events) return { kind: 'limit_events' }
      const t = now()
      const eid = id ?? freshEventId()
      const before = entry.updated
      const counts = old?.counts ?? { opened: 0, joined: 0, tagged: 0 }
      entry.events[eid] = { event, link, invitees, counts, created: old?.created ?? t, updated: t }
      entry.updated = t
      eventOrg.set(eid, org)
      await commit(() => {
        if (old === undefined) {
          delete entry.events[eid]
          eventOrg.delete(eid)
        } else {
          entry.events[eid] = old
        }
        entry.updated = before
      })
      return { kind: old === undefined ? 'created' : 'updated', id: eid, counts }
    },

    /** Removes the own event `id`. Resolves {kind: 'deleted'}, {kind: 'forbidden'} or {kind: 'not_found'}. */
    async deleteEvent(org, secret, id) {
      const entry = opened(org, secret)
      if (entry === undefined) return { kind: 'forbidden' }
      const old = entry.events[id]
      if (old === undefined) return { kind: 'not_found' }
      const before = entry.updated
      delete entry.events[id]
      eventOrg.delete(id)
      entry.updated = now()
      await commit(() => {
        entry.events[id] = old
        eventOrg.set(id, org)
        entry.updated = before
      })
      return { kind: 'deleted' }
    },

    /** One count more for `kind` on event `id`; nothing happens for an unknown id. Keeps no request data and does not touch `updated`. */
    hit(id, kind) {
      const org = eventOrg.get(id)
      if (org === undefined) return
      orgs.get(org).events[id].counts[kind] += 1
      background()
    },

    /** ADMIN: sets the plan. Resolves {kind: 'ok', plan} or {kind: 'unknown'}. */
    async setPlan(org, plan) {
      const entry = orgs.get(org)
      if (entry === undefined) return { kind: 'unknown' }
      const before = { plan: entry.plan, updated: entry.updated }
      entry.plan = plan
      entry.updated = now()
      await commit(() => Object.assign(entry, before))
      return { kind: 'ok', plan }
    },
  }
}
