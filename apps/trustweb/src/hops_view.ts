/**
 * The wave-6 controls (hops.ts, cascade.ts) as DOM, kept out of main.ts:
 * "How far?" in the ask dock, the per-item on/off switch and degrees chooser,
 * the small (i) that explains the cascade, the "through <name>" mark on an
 * answer and the per-person "Pass their asks on" switch. Every string comes
 * from strings.ts.
 */
import { el } from '../../demo/src/ui/dom'
import { Audience } from './model'
import type { InventoryItem } from './model'
import { DEGREES_CHOICES, DEGREES_MAX, DegreesChoice, degreesChoice, degreesFor, itemDegrees } from './cascade'
import { effectiveMaxHops, HOP_CAP, HOPS_UNBOUNDED, REACH_CHOICES, ReachChoice, reachChoice, reachFor, readVia } from './hops'
import { S } from './strings'

/** A compact on/off switch (Jakob's #22, less elongated): a button with role="switch". */
export function onOffSwitch(on: boolean, onToggle: () => void, extra: Record<string, string> = {}): HTMLElement {
  return el('button', {
    class: 'mini switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(on), 'aria-label': S.itemSwitchAria,
    title: on ? S.itemSwitchOn : S.itemSwitchOff, onclick: onToggle, ...extra,
  }, [el('span', { class: 'knob', 'aria-hidden': 'true' }), el('span', { class: 'switch-lbl' }, [on ? S.itemSwitchOn : S.itemSwitchOff])])
}

/** A number box for the Custom choice; commits on change, clamped by the caller. */
function customBox(value: number, min: number, max: number, aria: string, commit: (n: number) => void, data: string): HTMLElement {
  const box = el('input', { class: 'field steps', type: 'number', min: String(min), max: String(max), step: '1', value: String(value), 'aria-label': aria, [data]: '1' })
  box.addEventListener('change', () => commit(Number(box.value)))
  return box
}

/** "How far?" in the ask dock: my contacts (default) / friends of friends / 3 / custom / no limit. */
export function reachChooser(reach: number, disabled: boolean, onChange: (reach: number) => void): HTMLElement {
  const current = reachChoice(reach)
  const steps = effectiveMaxHops(reach)
  const custom = current === ReachChoice.Custom ? steps : 4
  return el('div', { class: 'reach', 'data-reach': String(reach) }, [
    el('span', { class: 'chips-lbl' }, [S.reachTitle]),
    el('div', { class: 'chips reach-chips', role: 'radiogroup', 'aria-label': S.reachTitle }, REACH_CHOICES.map((c) => el('button', {
      class: 'chip' + (c === current ? ' on' : ''), role: 'radio', 'aria-checked': String(c === current), 'data-reach-choice': c, disabled,
      onclick: () => onChange(reachFor(c, custom)),
    }, [S.reachLabel[c]]))),
    current === ReachChoice.Custom && !disabled
      ? customBox(steps, 1, HOP_CAP, S.reachCustomAria, (n) => onChange(reachFor(ReachChoice.Custom, n)), 'data-reach-custom')
      : null,
    el('p', { class: 'hint', 'data-reach-hint': '1' }, [S.reachHint(steps, reach === HOPS_UNBOUNDED)]),
  ])
}

/** The degrees chooser on an item's sheet, under "Who can ask about it" (Jakob: first the audience, then how many degrees). */
export function degreesChooser(item: InventoryItem, onChange: (degrees: number) => void): HTMLElement[] {
  if (item.audience === Audience.OnlyMe) {
    return [el('h4', { class: 'eyebrow' }, [S.degreesTitle]), el('p', { class: 'meta', 'data-degrees-none': '1' }, [S.degreesNoAudience])]
  }
  const degrees = itemDegrees(item)
  const current = degreesChoice(degrees)
  const custom = current === DegreesChoice.Custom ? degrees : 3
  return [
    el('h4', { class: 'eyebrow' }, [S.degreesTitle]),
    ...DEGREES_CHOICES.map((c) => el('button', {
      class: 'radio' + (c === current ? ' on' : ''), 'aria-pressed': String(c === current), 'data-item-degrees': c,
      onclick: () => onChange(degreesFor(c, custom)),
    }, [el('b', {}, [S.degreesLabel[c]]), el('small', {}, [S.degreesHint[c]])])),
    current === DegreesChoice.Custom
      ? customBox(degrees, 1, DEGREES_MAX, S.degreesCustomAria, (n) => onChange(degreesFor(DegreesChoice.Custom, n)), 'data-degrees-custom')
      : null,
  ].filter((n): n is HTMLElement => n !== null)
}

/** The small degrees pill on an inventory row, next to the audience pill. */
export function degreesPill(item: InventoryItem, onClick: () => void): HTMLElement | null {
  if (item.audience === Audience.OnlyMe) return null
  return el('button', { class: 'deg-pill', 'data-degrees-pill': String(itemDegrees(item)), onclick: onClick }, [S.degreesPill(itemDegrees(item))])
}

/** The small (i) just below Settings (Jakob 2026-10-07: "a small one, to let people understand how it works in very brief sentences"). */
export function cascadeInfoButton(open: () => void): HTMLElement {
  return el('button', { class: 'hint-i cascade-i', 'aria-label': S.cascadeInfoAria, title: S.cascadeInfoTitle, 'data-cascade-info': '1', onclick: open }, ['i'])
}

/** What the (i) opens. */
export function cascadeInfoContent(): HTMLElement[] {
  return [
    el('h3', {}, [S.cascadeInfoTitle]),
    ...S.cascadeInfo.map((t) => el('p', { class: 'meta' }, [t])),
  ]
}

/** "through Ben" under an answer line that came back through someone; nothing for the answering person's own line. */
export function throughTag(via: unknown): HTMLElement | null {
  const names = readVia(via)
  return names.length ? el('em', { class: 'through', 'data-through': names.join('|') }, [S.resultThrough(names)]) : null
}

/**
 * The title of one answer card (U1 hand-over item): "Ben chose to share" when the answering person shared a line of their own, but
 * "Ben passed this on" when every line came back through them (they chose nothing of their own to share).
 */
export function answerTitle(from: string, items: readonly { via?: unknown }[]): string {
  return items.length > 0 && items.every((it) => readVia(it.via).length > 0) ? S.resultPassedOn(from) : S.resultShared(from)
}

/**
 * On a person's card: may their asks go on through me ("Pass their asks on"). `on` is the EFFECTIVE value
 * (one_jakob.ts passOnAllowed: on for a person unless switched off for them; on by default since 2026-10-09), so the
 * switch shows what the phone does and one tap flips it.
 */
export function passOnRow(on: boolean, onToggle: (next: boolean) => void): HTMLElement {
  return el('button', {
    class: 'radio' + (on ? ' on' : ''), 'aria-pressed': String(on), 'data-pass-on': '1',
    onclick: () => onToggle(!on),
  }, [el('b', {}, [S.passOnTitle]), el('small', {}, [S.passOnHint])])
}
