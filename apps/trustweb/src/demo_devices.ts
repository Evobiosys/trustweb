/**
 * Removing a device (wave 5, item g; owner 2026-10-07: "it should also be possible to remove a device").
 * Pure rules, no DOM, shared by the two places that have devices:
 *
 *   The demo page (solo.ts): up to four phones side by side, each a persona. Removing one frees its persona; the
 *     page remembers WHICH personas are open (a list, not a count), so removing the middle phone and adding again never
 *     opens a persona that is already on screen (two iframes on one persona would share one storage record and one identity).
 *     The first device (the holder, whose connect link the others joined) is the current device and is never removed.
 *   The real app: its devices are the demo accounts it handed out (Settings > Demo accounts / QR > Demo account).
 *     A tab that IS a demo account (state.testOf) never ends its own account, whatever is asked of it.
 */
import type { AppState } from './model'
import type { Persona } from './seed'

/** A comma list is the new format; a bare number n (the old format) means the first n personas of the order. */
export function parseDevices(raw: string | null, order: readonly Persona[]): Persona[] {
  const first = order[0]
  if (!raw) return [first]
  const n = Number(raw)
  if (Number.isInteger(n) && n >= 1 && n <= order.length) return order.slice(0, n)
  const listed = raw.split(',').map((x) => x.trim()).filter((x): x is Persona => (order as readonly string[]).includes(x))
  const unique = [...new Set(listed)]
  return [first, ...unique.filter((p) => p !== first)]
}

/**
 * The stored form. The old build stored a count, and a rollback reads only that: so while the open devices are exactly the
 * first n of the order (nothing removed from the middle) the count is written, and only a gap (a removed middle phone) writes the list.
 */
export function serializeDevices(devices: readonly Persona[], order: readonly Persona[]): string {
  const prefix = devices.length > 0 && devices.every((p, i) => p === order[i])
  return prefix ? String(devices.length) : devices.join(',')
}

/** The persona "Add a device" opens next: the first of the order that is not open. Null when all are open. */
export function nextDevice(open: readonly Persona[], order: readonly Persona[]): Persona | null {
  return order.find((p) => !open.includes(p)) ?? null
}

export enum RemoveVerdict {
  Removable = 'removable',
  /** The first device: the current one, never removed. */
  FirstDevice = 'first-device',
  NotOpen = 'not-open',
}

export function removeVerdict(open: readonly Persona[], target: Persona, order: readonly Persona[]): RemoveVerdict {
  if (target === order[0]) return RemoveVerdict.FirstDevice
  return open.includes(target) ? RemoveVerdict.Removable : RemoveVerdict.NotOpen
}

/** The open devices without `target` (the others keep their order). */
export function withoutDevice(open: readonly Persona[], target: Persona): Persona[] {
  return open.filter((p) => p !== target)
}

/** The real app: may this tab end the demo account `accountId`? Not when it IS that account. */
export function canEndDemoAccount(current: AppState['testOf'], accountId: string): boolean {
  return current?.accountId !== accountId
}
