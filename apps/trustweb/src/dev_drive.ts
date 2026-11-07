// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Dev-only (wave 31): Walk drives. For each step the walker either rings and taps its target, first brings the app to the row's view
 * (navPlan) when the target is not on this screen, or, still missing, rings the bottom-bar button to use and says where to go.
 * Next does the current step now, Back goes one step back and pauses. Pure; dev_steps.ts runs it in the page.
 */
import { navNote, type NavPlan, type NavTap } from './dev_navigate'
import { S } from './strings'

export type StepMove =
  | { kind: 'card' }
  | { kind: 'tap'; selector: string }
  | { kind: 'nav'; taps: NavTap[] }
  | { kind: 'missing'; ring: string | null; note: string }

/** The bottom-bar button (or the Settings gear) of the screen a row's `context` lives on; null for the panel or an unknown context. */
export function homeButton(context: string | undefined): string | null {
  const c = context?.trim().toLowerCase().replace(/^trustweb-/, '') ?? ''
  if (['web', 'trustzones', 'map', 'network', 'people'].includes(c)) return '[data-go="web"]'
  if (['chat', 'events', 'inventory'].includes(c)) return `[data-go="${c}"]`
  return c === 'settings' ? '[data-settings-gear]' : null
}

/** What to do for `step`: `visible` = its target is on screen, `navTried` = the row's navigation was already done for this step,
 *  `plan` = navPlan from where the app is now to the row's `context`. */
export function stepMove(step: { text: string; selector: string | null }, visible: boolean, navTried: boolean, plan: NavPlan, context: string | undefined): StepMove {
  if (!step.selector) return { kind: 'card' }
  if (visible) return { kind: 'tap', selector: step.selector }
  if (!navTried && plan.taps.length) return { kind: 'nav', taps: plan.taps }
  if (!plan.path) return { kind: 'missing', ring: null, note: S.walkNotHere(step.text) }
  return { kind: 'missing', ring: plan.taps[0]?.selector ?? homeButton(context), note: navNote(plan) }
}

/** `at` = the step to do next; `auto` = the walker does it by itself after the pause. */
export interface DriveState { at: number; auto: boolean }

export function driveNext(s: DriveState, e: 'done' | 'next' | 'back' | 'stuck', n: number): DriveState {
  switch (e) {
    case 'done': return { ...s, at: Math.min(s.at + 1, n) }
    case 'next': return { ...s, auto: true }
    case 'back': return { at: Math.max(0, s.at - 1), auto: false }
    case 'stuck': return { ...s, auto: false }
  }
}

/** The walk's list: the row's steps, then the feature itself (`title @ selector`) unless the last step points at it already.
 *  The walker taps every step but the last, which it only rings ("Here it is"). */
export function walkList(steps: string[], title: string, selector?: string): string[] {
  const last = steps[steps.length - 1] as string | undefined
  if (selector && last?.endsWith(' @ ' + selector)) return steps
  return [...steps, selector ? `${title} @ ${selector}` : title]
}
