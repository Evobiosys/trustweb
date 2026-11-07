// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * The Expanse (wave 32): people dropped on the rings' orange ⛶ control are hidden from the rings. They keep their ring membership
 * (nothing is deleted); the record key `expanse` lists their ids, absent while empty. Local, rides the device sync with the record.
 */
import type { Person } from './model'

type Held = { expanse?: string[] }

export const inExpanse = (s: Held, id: string): boolean => s.expanse?.includes(id) ?? false

export function hideInExpanse(s: Held, id: string): void {
  if (!inExpanse(s, id)) s.expanse = [...(s.expanse ?? []), id]
}

export function bringBack(s: Held, id: string): void {
  const rest = (s.expanse ?? []).filter((x) => x !== id)
  if (rest.length) s.expanse = rest
  else delete s.expanse
}

export function bringAllBack(s: Held): void {
  delete s.expanse
}

/** The hidden people that still exist, in the order they were hidden. */
export function expanseList(s: Held & { people: readonly Person[] }): Person[] {
  return (s.expanse ?? []).flatMap((id) => s.people.find((p) => p.id === id) ?? [])
}

/** Whether a pointer at (x, y) is over a control's box. */
export const overControl = (b: { left: number; top: number; right: number; bottom: number }, x: number, y: number): boolean =>
  x >= b.left && x <= b.right && y >= b.top && y <= b.bottom

/** The control under a pointer at (x, y) among the bottom row's boxes (expanse control and every ring's ⛶), or null. */
export const hitControls = <T extends { left: number; top: number; right: number; bottom: number }>(boxes: readonly T[], x: number, y: number): T | null =>
  boxes.find((b) => overControl(b, x, y)) ?? null

/** People still on the rings: the hidden ones leave before any "closest five" is picked. */
export const visibleIn = <P extends { id: string }>(s: Held, people: readonly P[]): P[] => people.filter((p) => !inExpanse(s, p.id))
