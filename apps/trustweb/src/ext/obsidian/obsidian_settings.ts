// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 41 obsidian-sync: the rows under Settings > General > Extensions > Obsidian vault: the opt-in for complete ingestion, where it would send, and "Forget this vault". */
import { el } from '../../../../demo/src/ui/dom'
import { S } from '../../strings'
import type { TwCtx, TwSettingsSection } from '../tw_registry'
import { MODULE_ID, parseObsidian } from './obsidian_data'
import { ingestTarget } from './obsidian_endpoint'
import { ingestOptIn, setIngestOptIn } from './obsidian_prefs'
import { openVaultStore } from './obsidian_cache'

const T = S.obsidian

/** Where complete ingestion would send, in one line; the owner reads it before switching on. */
export function targetLine(ai: Parameters<typeof ingestTarget>[0]): string {
  const t = ingestTarget(ai)
  return t.ok ? T.ingestTo(t.label, t.host, t.model) : t.why === 'cloud' ? T.ingestCloud : T.ingestNone
}

function rows(ctx: TwCtx): Node[] {
  const on = ingestOptIn()
  const sw = el('button', { class: 'radio' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(on), 'data-obsidian-ingest-switch': '' }, [el('b', {}, [T.setIngest]), el('small', {}, [T.setIngestHint])])
  sw.addEventListener('click', () => {
    const next = !ingestOptIn()
    setIngestOptIn(next)
    sw.className = 'radio' + (next ? ' on' : ''); sw.setAttribute('aria-checked', String(next))
  })
  const vault = el('p', { class: 'meta', 'data-obsidian-vault': '' }, [T.setNoVault])
  const done = el('small', { class: 'meta', hidden: true }, [T.setForgot])
  const store = openVaultStore(ctx.store().me.id)
  const showVault = (): void => {
    const name = parseObsidian(ctx.store().extData?.[MODULE_ID]).vault
    void store.all().then((n) => { vault.textContent = n.length ? T.setVault(name ?? '', n.length) : T.setNoVault })
  }
  showVault()
  return [
    sw,
    el('p', { class: 'meta', 'data-obsidian-target': '' }, [targetLine(ctx.store().advanced?.ai)]),
    vault,
    el('button', {
      class: 'linkbtn', 'data-obsidian-forget': '', style: 'text-decoration:underline',
      onclick: () => {
        void store.forget().then(() => {
          const s = ctx.store()
          const { [MODULE_ID]: _gone, ...rest } = s.extData ?? {}
          s.extData = rest
          ctx.bus.emit('save')
          done.hidden = false
          showVault()
        })
      },
    }, [T.setForget]),
    done,
  ]
}

export const settingsSection = (ctx: TwCtx): TwSettingsSection[] => [{ id: MODULE_ID, title: T.title, rows: () => rows(ctx) }]
