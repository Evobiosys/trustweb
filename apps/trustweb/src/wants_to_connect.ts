/**
 * Wave 16 (Jakob 2026-10-19): someone who reached out through my public link is not put on my rings. They wait in "Wants to connect"
 * under the web (AppState.wantsToConnect) until I add them (a Person, ring picked) or dismiss them (into the Web Curator's Archive as a
 * not-connected person, Person.wantsToConnect kept, so Restore puts the row back). Their peer stays connected on the wire meanwhile.
 * This device only: peer ids differ per device, so the list is not part of a device sync.
 */
import { Ring } from './model'
import type { AppState, Person, WantsToConnect } from './model'

/** A reach-out arrived: one row per peer (a second reach-out of the same peer keeps the first row). */
export function addWant(s: Pick<AppState, 'wantsToConnect'>, row: WantsToConnect): void {
  const list = s.wantsToConnect ?? []
  if (!list.some((w) => w.peerId === row.peerId)) s.wantsToConnect = [...list, row]
}

/** Takes the row out; returns it (null when there was none). */
export function takeWant(s: Pick<AppState, 'wantsToConnect'>, peerId: string): WantsToConnect | null {
  const row = s.wantsToConnect?.find((w) => w.peerId === peerId) ?? null
  if (!row) return null
  const rest = s.wantsToConnect!.filter((w) => w !== row)
  if (rest.length) s.wantsToConnect = rest
  else delete s.wantsToConnect
  return row
}

/** "Add": the row becomes a Person on the picked ring, connected (peerId). */
export function acceptWant(s: Pick<AppState, 'wantsToConnect' | 'people'>, peerId: string, name: string, ring: Ring, id: string): Person | null {
  const row = takeWant(s, peerId)
  if (!row) return null
  const p: Person = { id, name: name || row.name, context: '', ring, metAt: Date.now(), lines: [], peerId }
  s.people.push(p)
  return p
}

/** "Dismiss": the row becomes the Archive entry (the caller hides it through the Curator); not connected, the row kept on it. */
export function dismissWant(s: Pick<AppState, 'wantsToConnect' | 'people'>, peerId: string, id: string): Person | null {
  const row = takeWant(s, peerId)
  if (!row) return null
  const p: Person = { id, name: row.name, context: '', ring: Ring.Acquaintance, metAt: row.at, lines: [], wantsToConnect: row }
  s.people.push(p)
  return p
}
