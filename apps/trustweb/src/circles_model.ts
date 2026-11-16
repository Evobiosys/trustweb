// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-circles-view: the Circles view (Google+ style, research-google-plus-circles.txt). Each tag is one circle, drawn as a ring of avatars around its
 * name; one person can sit in several circles. Pure, no DOM, no value imports (apps/mcp/src/circles_tools.ts loads this file with plain node).
 */
export interface CircleTag { id: string; label?: string; colour: string }
export interface Circle { id: string; name: string; colour: string; members: string[]; size: number }

/** Circle diameter in px: grows with its members, never beyond CIRCLE_MAX (one row of circles must fit the phone: 360 px shows two). */
export const CIRCLE_MIN = 104
export const CIRCLE_MAX = 168
export const CIRCLE_STEP = 8
/** Avatars drawn on one ring; more members show as "+N" (tap the circle to open all). */
export const RING_MAX = 10
/** Id of the empty "Drop here to create a new circle" tile. */
export const NEW_CIRCLE = 'new'

export const circleSize = (members: number): number => Math.min(CIRCLE_MAX, CIRCLE_MIN + CIRCLE_STEP * Math.max(0, members))

/** One circle per tag, in tag order (a stable layout while people are dragged); `membersOf` resolves groups (colour_tags.ts memberIds). */
export const circlesOf = (tags: readonly CircleTag[], membersOf: (tagId: string) => string[]): Circle[] =>
  tags.map((t) => { const members = membersOf(t.id); return { id: t.id, name: t.label ?? t.id, colour: t.colour, members, size: circleSize(members.length) } })

/** Where the first `n` avatars sit on a ring, as fractions of the circle's width (0.5, 0.5 = centre), clockwise from 12 o'clock. */
export function ringSlots(n: number, radius = 0.5): { x: number; y: number }[] {
  const shown = Math.min(n, RING_MAX)
  return Array.from({ length: shown }, (_, i) => {
    const a = (2 * Math.PI * i) / shown - Math.PI / 2
    return { x: 0.5 + radius * Math.cos(a), y: 0.5 + radius * Math.sin(a) }
  })
}

/** How many members the ring leaves out ("+N"). */
export const hiddenCount = (members: number): number => Math.max(0, members - RING_MAX)

export interface DropEffect { add?: string; remove?: string; /** The drop was on the empty tile: a new circle is made and the person added to it. */ create?: boolean }

/**
 * What a drop does. `from` = the circle the avatar was lifted out of (null: the pool); `to` = the circle it is dropped on, NEW_CIRCLE, or null (outside every circle).
 * Into a circle adds the tag (also from another circle: a person sits in several); out of a circle, onto the pool, removes that circle's tag.
 * `held` = the circles the person is in now.
 */
export function dropEffect(from: string | null, to: string | null, held: ReadonlySet<string>): DropEffect {
  if (to === NEW_CIRCLE) return { create: true }
  if (to === null) return from !== null && held.has(from) ? { remove: from } : {}
  return held.has(to) ? {} : { add: to }
}
