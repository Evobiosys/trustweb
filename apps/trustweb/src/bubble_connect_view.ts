// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-bubble-connect: the progress ring on the held-on bubble, the "Introduce A and B?" sheet and the sending (bubble_connect.ts
 * holds the rules). main.ts passes `introduce` to the Web view and calls `drain` once; the MCP tool introduce_people queues, `drain` sends.
 */
import { el } from '../../demo/src/ui/dom'
import { introduceBlock, MERGE_HOLD_MS, takeIntroQueue, type IntroBlock } from './bubble_connect'
import { introduceTexts } from './bubble_links'
import { LogOutcome } from './model'
import type { AppState } from './model'
import { S } from './strings'

const SVG = 'http://www.w3.org/2000/svg'

/** The ring that fills around `target` over MERGE_HOLD_MS (CSS animation, so no timer); the returned function takes it away. */
export function holdRing(target: HTMLElement): () => void {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'hold-ring')
  svg.setAttribute('data-hold-ring', '')
  svg.setAttribute('viewBox', '0 0 40 40')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.setProperty('--hold-ms', `${MERGE_HOLD_MS}ms`)
  const c = document.createElementNS(SVG, 'circle')
  for (const [k, v] of Object.entries({ cx: '20', cy: '20', r: '18', pathLength: '100' })) c.setAttribute(k, v)
  svg.appendChild(c)
  target.appendChild(svg)
  return () => svg.remove()
}

export interface BubbleConnectDeps {
  st(): AppState
  save(): void
  render(): void
  openSheet(nodes: Node[]): void
  closeSheet(): void
  toast(msg: string): void
  appUrl: string
  /** Queues the text for the person's chat and sends it when the relay is up (chat_view.ts submitText). */
  send(peerId: string, text: string): Promise<boolean>
}

export function createBubbleConnect(d: BubbleConnectDeps): { introduce(aId: string, bId: string): void; drain(): void } {
  const blockText = (b: IntroBlock): string => S.introduceBlock[b]
  /** Sends both texts; false = nothing could be built (too long). */
  const send = async (aId: string, bId: string): Promise<boolean> => {
    const s = d.st()
    const a = s.people.find((p) => p.id === aId)
    const b = s.people.find((p) => p.id === bId)
    if (!a || !b || introduceBlock(a, b, s.peers)) return false
    const t = introduceTexts(d.appUrl, a, b, s.peers, s.me.displayName)
    if (!t) return false
    await Promise.all([d.send(t.toA.peerId, t.toA.text), d.send(t.toB.peerId, t.toB.text)])
    s.log.unshift({ id: `intro-${Date.now().toString(36)}`, at: Date.now(), from: s.me.displayName, text: S.introduceLog(a.name, b.name), outcome: LogOutcome.Shared })
    d.save()
    return true
  }
  const introduce = (aId: string, bId: string): void => {
    const s = d.st()
    const a = s.people.find((p) => p.id === aId)
    const b = s.people.find((p) => p.id === bId)
    if (!a || !b) return
    const block = introduceBlock(a, b, s.peers)
    if (block) { d.toast(blockText(block)); return }
    d.openSheet([
      el('div', { 'data-introduce-sheet': '' }, [
        el('h3', {}, [S.introduceTitle(a.name, b.name)]),
        el('p', { class: 'meta' }, [S.introduceBody]),
        el('button', { class: 'btn btn-electric', 'data-introduce-yes': '', onclick: () => { d.closeSheet(); void send(aId, bId).then((ok) => { d.toast(ok ? S.introduceDone(a.name, b.name) : S.introduceBlock['too-long']); d.render() }) } }, [S.introduceYes]),
        el('button', { class: 'btn btn-ghost', 'data-introduce-no': '', onclick: d.closeSheet }, [S.introduceNo]),
      ]),
    ])
  }
  /** Introductions an MCP client queued while the app was closed: sent now, once. */
  const drain = (): void => {
    const q = takeIntroQueue(d.st())
    if (!q.length) return
    d.save()
    for (const i of q) void send(i.a, i.b)
  }
  return { introduce, drain }
}
