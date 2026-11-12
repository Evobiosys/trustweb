// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 41 obsidian-sync: the page's side of the Web Worker. Without Worker support (or when it fails to start) the same scan runs on the page's thread. */
import type { Scanner, ScanResult } from './obsidian_scan'
import { scanAll } from './obsidian_scan'

type Message = { type: 'progress'; done: number; total: number } | { type: 'result'; result: ScanResult } | { type: 'error'; message: string }

/** One worker per scan, ended when it answers. */
export const workerScanner: Scanner = (files, known, onProgress) => {
  if (typeof Worker === 'undefined') return scanAll(files, known, onProgress)
  return new Promise<ScanResult>((resolve, reject) => {
    let w: Worker
    try { w = new Worker(new URL('./obsidian_worker.ts', import.meta.url), { type: 'module' }) } catch { resolve(scanAll(files, known, onProgress)); return }
    const end = (): void => w.terminate()
    w.onmessage = (e: MessageEvent<Message>): void => {
      const m = e.data
      if (m.type === 'progress') onProgress?.(m.done, m.total)
      else if (m.type === 'result') { end(); resolve(m.result) }
      else { end(); reject(new Error(m.message)) }
    }
    w.onerror = (): void => { end(); resolve(scanAll(files, known, onProgress)) }
    w.postMessage({ files, known })
  })
}
