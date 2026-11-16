// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-people-picker-2: "Scan a code" under my own QR code: the existing camera scanner (apps/demo ui/scanner.ts) in place; what it reads goes to `onText`. */
import { el } from '../../demo/src/ui/dom'
import { scanQr } from '../../demo/src/ui/scanner'
import type { ScanHandle } from '../../demo/src/ui/scanner'
import { S } from './strings'

/** `button` goes right under the code; `view` (camera picture and a note) goes below the other controls so it never pushes them out of the viewport. */
export function scanButton(onText: (text: string) => void): { button: HTMLElement; view: HTMLElement } {
  const video = el('video', { class: 'scan-video', hidden: true, 'data-scan-video': '' }) as HTMLVideoElement
  const note = el('p', { class: 'meta', role: 'status', 'data-scan-note': '' })
  let handle: ScanHandle | null = null
  const stop = (): void => { handle?.stop(); handle = null; video.hidden = true; btn.textContent = S.w44pp2.scanCode }
  const btn = el('button', { class: 'btn btn-ghost', type: 'button', 'data-scan-code': '', onclick: () => {
    if (handle) { stop(); return }
    note.textContent = ''
    video.hidden = false
    btn.textContent = S.w44pp2.scanStop
    const h = scanQr(video, (text) => { stop(); onText(text) })
    handle = h
    h.ready.catch(() => { if (handle === h) { stop(); note.textContent = S.w44pp2.scanNoCamera } })
  } }, [S.w44pp2.scanCode])
  return { button: el('div', { class: 'scan-code', 'data-scan': '' }, [btn]), view: el('div', { class: 'scan-view' }, [video, note]) }
}
