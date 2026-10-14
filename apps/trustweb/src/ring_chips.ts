/** The ring label of a person; a tap on it opens the chip row of every ring in place (no sheet, no dropdown). */
import { el } from '../../demo/src/ui/dom'
import { Ring, RINGS, ringColor } from './model'
import type { Person } from './model'
import { S } from './strings'

const CHOICES: readonly Ring[] = [...RINGS, Ring.Family, Ring.Unsorted, Ring.None]
const dotColor = (r: Ring): string => ringColor({ ring: r })

export function ringChips(p: Person, pick: (r: Ring) => void): HTMLElement {
  const row = el('div', { class: 'rchips', hidden: '' }, CHOICES.map((r) => el('button', {
    class: 'rchip' + (p.ring === r ? ' on' : ''), style: `--rc:${dotColor(r)}`, 'aria-pressed': String(p.ring === r),
    onclick: (e) => { e.stopPropagation(); pick(r) },
  }, [r === Ring.Unsorted ? S.ringLeaveUnsorted : S.ringLabel[r]])))
  const label = el('button', {
    class: 'rlabel', style: `--rc:${ringColor(p)}`, 'aria-expanded': 'false',
    onclick: (e) => { e.stopPropagation(); row.hidden = !row.hidden; label.setAttribute('aria-expanded', String(!row.hidden)) },
  }, [S.ringLabel[p.ring]])
  return el('span', { class: 'rchip-wrap' }, [label, row])
}
