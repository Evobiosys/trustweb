// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 41 obsidian-sync: the page's side of the Web Worker. Without Worker support, when it fails to start, answers with something that cannot be
 * cloned (messageerror) or goes quiet for `stallMs`, the same scan runs on the page's thread. An abort ends the worker at once.
 */
import type { Scanner, ScanResult } from './obsidian_scan'
import { scanAll } from './obsidian_scan'

type Message = { type: 'progress'; done: number; total: number } | { type: 'result'; result: ScanResult } | { type: 'error'; message: string }

/** The worker reports every 50 notes; a minute without a word means it is stuck. */
export const STALL_MS = 60_000

/** One worker per scan, ended when it answers. */
export const makeWorkerScanner = (stallMs: number): Scanner => (files, known, onProgress, signal) => {
  if (signal?.aborted) return Promise.reject(signal.reason)
  if (typeof Worker === 'undefined') return scanAll(files, known, onProgress, signal)
  return new Promise<ScanResult>((resolve, reject) => {
    let w: Worker
    try { w = new Worker(new URL('./obsidian_worker.ts', import.meta.url), { type: 'module' }) } catch { resolve(scanAll(files, known, onProgress, signal)); return }
    let timer: ReturnType<typeof setTimeout> | undefined
    const aborted = (): void => { end(); reject(signal?.reason) }
    const end = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); w.terminate() }
    const here = (): void => { end(); resolve(scanAll(files, known, onProgress, signal)) }
    const alive = (): void => { clearTimeout(timer); timer = setTimeout(here, stallMs) }
    signal?.addEventListener('abort', aborted, { once: true })
    w.onmessage = (e: MessageEvent<Message>): void => {
      const m = e.data
      if (m.type === 'progress') { alive(); onProgress?.(m.done, m.total) }
      else if (m.type === 'result') { end(); resolve(m.result) }
      else { end(); reject(new Error(m.message)) }
    }
    w.onerror = here
    w.onmessageerror = here
    alive()
    w.postMessage({ files, known })
  })
}

export const workerScanner = makeWorkerScanner(STALL_MS)
