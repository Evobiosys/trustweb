// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * The Map view of the Web tab (wave 27): an equirectangular world outline (Natural Earth 110m, its own lazy chunk) with one dot per place,
 * and under it every person with a place box: typing suggests places (place_suggest.ts), Enter takes the first and pins the dot at once.
 * Everything local (I1): the table is bundled, nothing is sent.
 */
import { el } from '../../demo/src/ui/dom'
import { activateKey } from './key_press'
import type { Person } from './model'
import { clearPlace, pinGroups, placeSuggest, project, setPlace } from './place_suggest'
import type { PersonPlace, PlaceHit } from './place_suggest'
import { S } from './strings'

export interface MapOptions {
  people: readonly Person[]
  openPerson: (id: string) => void
  /** Persist the record after a place was written or removed. */
  save: () => void
  /** The People view body (ring categories) with `extra` drawn beside every person's row. */
  peopleList: (extra: (p: Person) => Node[]) => HTMLElement
}

const W = 720
const H = 360
const SVG_NS = 'http://www.w3.org/2000/svg'

function svg(tag: string, attrs: Record<string, string>, text?: string): SVGElement {
  const n = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
  if (text !== undefined) n.textContent = text
  return n
}

type Ring = number[][]
interface Geometry { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] }

/** SVG path data of one country geometry. */
function outlinePath(g: Geometry): string {
  const polys = (g.type === 'Polygon' ? [g.coordinates as Ring[]] : (g.coordinates as Ring[][]))
  return polys.flatMap((rings) => rings.map((ring) => 'M' + ring.map(([lon, lat]) => { const p = project(lat, lon, W, H); return `${p.x.toFixed(1)} ${p.y.toFixed(1)}` }).join('L') + 'Z')).join('')
}

let outline: Promise<string> | null = null
function worldPath(): Promise<string> {
  outline ??= import('./data/world_110m.json').then((m) => {
    const fc = (m.default ?? m) as unknown as { features: { geometry: Geometry }[] }
    return fc.features.map((f) => outlinePath(f.geometry)).join('')
  })
  return outline
}


export function createMapView(opts: MapOptions): HTMLElement {
  const { people, openPerson, save, peopleList } = opts
  const land = svg('path', { class: 'map-land', d: '' })
  const dots = svg('g', { class: 'map-dots' })
  const map = svg('svg', { class: 'map-svg', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': S.mapAria }) as SVGSVGElement
  map.append(land, dots)
  void worldPath().then((d) => land.setAttribute('d', d))

  const drawDots = (): void => {
    dots.replaceChildren(...pinGroups(people).flatMap((g) => {
      const { x, y } = project(g.lat, g.lon, W, H)
      const first = g.people[0]
      const label = g.people.length > 1 ? `${first.name} +${g.people.length - 1}` : first.name
      const dot = svg('g', { class: 'map-dot', 'data-map-dot': g.place, tabindex: '0', role: 'button', 'aria-label': `${g.place}: ${g.people.map((p) => p.name).join(', ')}` })
      dot.append(svg('circle', { cx: String(x), cy: String(y), r: '4' }), svg('text', { x: String(x + 6), y: String(y + 3) }, label))
      dot.addEventListener('click', () => openPerson(first.id))
      dot.addEventListener('keydown', activateKey(() => openPerson(first.id)))
      return [dot]
    }))
  }
  drawDots()

  /** The place box of one person: type a place, pick a suggestion, undo. Rides beside the person's row in the People view. */
  function placeEditor(p: Person): Node[] {
    const input = el('input', { class: 'field map-place', type: 'text', 'data-map-place': p.id, placeholder: S.mapPlacePh, 'aria-label': S.mapPlaceAria(p.name), value: p.place?.name ?? '', autocomplete: 'off' }) as HTMLInputElement
    const suggest = el('div', { class: 'map-sug' })
    const undo = el('button', { class: 'btn btn-ghost btn-sm', 'data-map-undo': p.id }, [S.mapUndo])
    undo.hidden = true
    let previous: PersonPlace | undefined
    const apply = (to: PlaceHit | undefined): void => {
      previous = to ? setPlace(p, to) : clearPlace(p)
      input.value = p.place?.name ?? ''
      suggest.replaceChildren()
      undo.hidden = false
      save()
      drawDots()
    }
    undo.onclick = (): void => { setPlace(p, previous); input.value = p.place?.name ?? ''; undo.hidden = true; save(); drawDots() }
    input.addEventListener('input', () => {
      suggest.replaceChildren(...placeSuggest(input.value).map((h) => el('button', { class: 'map-opt', type: 'button', 'data-map-opt': h.name, onclick: () => apply(h) }, [h.name])))
    })
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      const first = placeSuggest(input.value)[0]
      if (first) apply(first)
      else if (!input.value.trim() && p.place) apply(undefined)
    })
    return [input, undo, suggest]
  }
  return el('div', { class: 'map-view', 'data-map-view': '' }, [
    map as unknown as Node,
    el('p', { class: 'meta map-credit' }, [S.mapCredit]),
    // Wave 29: the flat 'Find someone' list is the People view (ring categories); each row keeps its place box.
    peopleList(placeEditor),
  ])
}
