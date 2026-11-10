// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 ai-edit-chat: what the dynamic import yields. init only listens on the bus (the sparkle emits "assistant-open", the import's
 * AI button "assistant-person"); the panel and its listeners are built on the first open, and dispose takes everything away again.
 */
import type { TwCtx, TwModuleBody } from '../tw_registry'
import { createPanel } from './panel'
import type { LookTarget } from './person_context'

let offs: (() => void)[] = []
let panel: ReturnType<typeof createPanel> | null = null

export const body: TwModuleBody = {
  init(ctx: TwCtx): void {
    const get = (): ReturnType<typeof createPanel> => (panel ??= createPanel(ctx))
    offs = [
      ctx.bus.on('assistant-open', () => get().toggle()),
      ctx.bus.on('assistant-person', (t) => { if (t && typeof t === 'object') get().person(t as LookTarget) }),
    ]
  },
  dispose(): void {
    for (const off of offs) off()
    offs = []
    panel?.dispose()
    panel = null
  },
}
