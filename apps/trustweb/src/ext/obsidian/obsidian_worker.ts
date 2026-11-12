// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 41 obsidian-sync: the Web Worker. Reads, hashes and parses the notes off the page's thread, so a big vault never freezes TrustWeb. */
import { scanAll } from './obsidian_scan'
import type { VaultFile } from './obsidian_files'

export interface ScanRequest { files: VaultFile[]; known: Record<string, string> }

const scope = self as unknown as { onmessage: ((e: MessageEvent<ScanRequest>) => void) | null; postMessage(m: unknown): void }
const STEP = 50

scope.onmessage = (e): void => {
  const { files, known } = e.data
  void scanAll(files, known, (done, total) => { if (done % STEP === 0 || done === total) scope.postMessage({ type: 'progress', done, total }) })
    .then((result) => scope.postMessage({ type: 'result', result }), (err) => scope.postMessage({ type: 'error', message: String(err) }))
}
