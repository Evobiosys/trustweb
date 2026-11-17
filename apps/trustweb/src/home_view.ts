// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 home-dashboard: the Home screen = a board of tiles in three columns (home_layout.ts). Default: the Web big in the centre, what others
 * ask of me on the left, what I asked on the right. Tiles are moved by pointer drag (touch: press and hold first, 500 ms, so the page still
 * scrolls), or with Alt + arrow keys on a focused tile. The layout is saved in the record as it changes.
 */
import { el } from '../../demo/src/ui/dom'
import { HOME_COLS, layoutOf, moveTile, setHomeLayout, type HomeCol, type HomeTile } from './home_layout'
import { tileData } from './home_data'
import { ringsThumbEl } from './home_thumb'
import type { AppState } from './model'
import { S } from './strings'

export interface HomeDeps {
  st: () => AppState
  save: () => void
  redraw: () => void
  openWeb: () => void
  openDashboard: () => void
  /** wave44c home-default: a request row opens its ask / connect card on the Web; See all opens the Existing requests list. */
  openRequest: (id: string) => void
  openRequests: () => void
}

const HOLD_MS = 500
const SLOP = 6
const NAMES: Record<HomeTile, string> = { asksToMe: S.home.asksToMe, connects: S.home.connects, web: S.home.web, asksSent: S.home.asksSent, invites: S.home.invites, requests: S.homeDefault.requests }

function tileBody(d: HomeDeps, id: HomeTile): Node[] {
  const s = d.st()
  if (id === 'web') {
    const n = s.people.filter((p) => !p.deleted_at).length
    return [el('b', {}, [S.home.web]), el('button', { class: 'home-thumb-btn', type: 'button', 'data-home-web-thumb': '', 'aria-label': S.homeDefault.thumbAria, onclick: () => d.openWeb() }, [ringsThumbEl(s.people.filter((p) => !p.deleted_at))]), el('span', { class: 'meta' }, [S.home.webPeople(n)]), el('button', { class: 'btn', type: 'button', 'data-home-web': '', onclick: () => d.openWeb() }, [S.home.webOpen])]
  }
  const data = tileData(s, id)
  const head = el('div', { class: 'home-tile-head' }, [el('b', {}, [NAMES[id]]), el('span', { class: 'meta' }, [id === 'invites' ? S.home.invitesCount(data.count) : S.home.count(data.count)])])
  if (id === 'invites') return [head]
  return [head, data.rows.length ? el('ul', { class: 'home-rows' }, data.rows.map((r) => el('li', {}, [el('button', { class: 'lnk home-req', type: 'button', 'data-home-request': r.id, onclick: () => d.openRequest(r.id) }, [r.text])]))) : el('p', { class: 'meta' }, [S.home.nothing]),
    ...(id === 'requests' ? [el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-home-requests-all': '', 'aria-label': S.homeDefault.requestsAria, onclick: () => d.openRequests() }, [S.homeDefault.openAll])] : [])]
}

export function createHomeBoard(d: HomeDeps): HTMLElement {
  const layout = layoutOf(d.st())
  let dragged = false

  const drop = (id: HomeTile, col: HomeCol, index: number): void => {
    setHomeLayout(d.st(), moveTile(layoutOf(d.st()), id, col, index))
    d.save()
    d.redraw()
  }

  /** The column under the point and the index among its tiles (by the tiles' vertical middles). */
  function targetAt(board: HTMLElement, x: number, y: number, self: HTMLElement): { col: HomeCol; index: number } | null {
    for (const col of HOME_COLS) {
      const c = board.querySelector<HTMLElement>(`[data-home-col="${col}"]`)!
      const r = c.getBoundingClientRect()
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue
      const others = [...c.querySelectorAll<HTMLElement>('[data-home-tile]')].filter((t) => t !== self)
      return { col, index: others.filter((t) => { const b = t.getBoundingClientRect(); return y > b.top + b.height / 2 }).length }
    }
    return null
  }

  function tile(id: HomeTile, board: () => HTMLElement): HTMLElement {
    const t = el('article', { class: 'home-tile' + (id === 'web' ? ' home-web' : ''), 'data-home-tile': id, tabindex: '0', 'aria-label': S.home.moveAria(NAMES[id]) }, tileBody(d, id))
    let start: { x: number; y: number; pid: number } | null = null
    let lifted = false
    let timer = 0
    const lift = (): void => { lifted = true; t.classList.add('lifted'); t.setPointerCapture(start!.pid) }
    t.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return
      start = { x: e.clientX, y: e.clientY, pid: e.pointerId }
      if (e.pointerType === 'touch') timer = window.setTimeout(lift, HOLD_MS)
    })
    t.addEventListener('pointermove', (e) => {
      if (!start) return
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      if (!lifted) {
        if (Math.hypot(dx, dy) < SLOP) return
        if (e.pointerType === 'touch') { window.clearTimeout(timer); start = null; return }   // the person scrolls
        lift()
      }
      t.style.transform = `translate(${dx}px, ${dy}px)`
    })
    const end = (e: PointerEvent, cancel: boolean): void => {
      window.clearTimeout(timer)
      if (lifted) {
        dragged = true
        window.setTimeout(() => { dragged = false }, 0)
        const to = cancel ? null : targetAt(board(), e.clientX, e.clientY, t)
        t.classList.remove('lifted'); t.style.transform = ''
        if (to) drop(id, to.col, to.index)
      }
      start = null; lifted = false
    }
    t.addEventListener('pointerup', (e) => end(e, false))
    t.addEventListener('pointercancel', (e) => end(e, true))
    t.addEventListener('touchmove', (e) => { if (lifted) e.preventDefault() }, { passive: false })
    t.addEventListener('contextmenu', (e) => { if (lifted || start) e.preventDefault() })
    t.addEventListener('click', (e) => { if (dragged) e.stopPropagation() }, true)
    t.addEventListener('keydown', (e) => {
      if (!e.altKey || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return
      const cur = HOME_COLS.find((c) => layoutOf(d.st())[c].includes(id))!
      const next = HOME_COLS[HOME_COLS.indexOf(cur) + (e.key === 'ArrowRight' ? 1 : -1)]
      if (next) { e.preventDefault(); drop(id, next, 0) }
    })
    return t
  }

  const root: HTMLElement = el('section', { class: 'home-board', 'data-home-board': '' }, [
    el('div', { class: 'row wrap home-top' }, [
      el('p', { class: 'meta' }, [S.home.dragHint]),
      el('button', { class: 'lnk strong', type: 'button', 'data-home-dashboard': '', onclick: () => d.openDashboard() }, [S.home.dashboard]),
    ]),
    el('div', { class: 'home-cols' }, HOME_COLS.map((col) => el('div', { class: 'home-col', 'data-home-col': col, role: 'group', 'aria-label': S.home.columns[col] }, layout[col].map((id) => tile(id, () => root))))),
  ])
  return root
}
