// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43c shell-fix-2 (43-D2): the "Pull from Tana" block of Settings > Import. Token field (kept on this device only, never in the record, a backup or a share),
 * Preview (reads from Tana's local API, changes nothing), then Apply or Cancel. Errors stay inline. Logic: tana_pull.ts.
 */
import { el } from '../../demo/src/ui/dom'
import { connect } from '../../crm/src/tana_sync'
import { PERSON_FIELDS } from '../../crm/src/person_fields'
import type { ServicesHooks } from './services_view'
import { S } from './strings'
import { applyPull, planPull, pullErrorKind, readPersons } from './tana_pull'
import type { PullPlan } from './tana_pull'

const T = S.shellFix2
const TOKEN_KEY = 'trustweb.tana.token'

export const tanaToken = (): string => { try { return localStorage.getItem(TOKEN_KEY) ?? '' } catch { return '' } }
const rememberToken = (v: string): void => { try { if (v) localStorage.setItem(TOKEN_KEY, v); else localStorage.removeItem(TOKEN_KEY) } catch { /* kept for this page only */ } }

/** One persistent block: it redraws itself, so the Import page's own redraws keep a running pull and its preview. */
export function tanaPullBlock(h: Pick<ServicesHooks, 'state' | 'save' | 'toast' | 'changed'>): HTMLElement {
  const root = el('div', { 'data-tana-pull': '' })
  let busy = ''
  let problem = ''
  let plan: { plan: PullPlan; unreadable: number } | null = null
  const token = el('input', { class: 'field', type: 'password', autocomplete: 'off', 'data-tana-token': '', 'aria-label': T.tanaTokenLabel, placeholder: T.tanaTokenLabel, value: tanaToken() }) as HTMLInputElement
  token.addEventListener('change', () => rememberToken(token.value.trim()))

  async function preview(): Promise<void> {
    const t = token.value.trim()
    rememberToken(t)
    plan = null
    if (!t) { problem = T.tanaPullErrToken; draw(); return }
    problem = ''
    busy = T.tanaPullBusy
    draw()
    try {
      const read = await readPersons(await connect(t), PERSON_FIELDS as never, {
        today: new Date().toISOString().slice(0, 10),
        onProgress: (d, n) => { busy = `${T.tanaPullBusy} ${d}/${n}`; draw() },
      })
      plan = { plan: planPull(h.state().people, read.entities), unreadable: read.unreadable.length }
    } catch (e) {
      const kind = pullErrorKind(e)
      problem = kind === 'reach' ? T.tanaPullErrReach : kind === 'auth' ? T.tanaPullErrAuth : T.tanaPullErrOther(e instanceof Error ? e.message : String(e))
    }
    busy = ''
    draw()
  }

  function apply(): void {
    if (!plan) return
    const { add, update } = plan.plan
    applyPull(h.state().people, plan.plan)
    h.save(); h.changed()
    h.toast(T.tanaPullDone(add.length, update.length))
    plan = null
    draw()
  }

  function draw(): void {
    const p = plan?.plan
    const changes = p ? p.add.length + p.update.length : 0
    const parts: (Node | null)[] = [
      el('h4', { class: 'eyebrow' }, [T.tanaPullTitle]),
      el('p', { class: 'meta', 'data-tana-pull-hint': '' }, [T.tanaPullHint]),
      el('label', { class: 'grp-field' }, [el('span', { class: 'chips-lbl' }, [T.tanaTokenLabel]), token]),
      el('p', { class: 'meta' }, [T.tanaTokenHint]),
      el('div', { class: 'cur-bar' }, [el('button', { class: 'btn btn-ghost', 'data-tana-preview': '', ...(busy ? { disabled: '' } : {}), onclick: () => void preview() }, [T.tanaPullPreview])]),
      busy ? el('p', { class: 'meta', role: 'status', 'data-tana-busy': '' }, [busy]) : null,
      problem ? el('p', { class: 'warn', role: 'alert', 'data-tana-problem': '' }, [problem]) : null,
      p ? el('div', { 'data-tana-plan': `${p.add.length}/${p.update.length}/${p.same}` }, [
        el('p', { class: 'meta' }, [changes ? T.tanaPullSummary(p.add.length, p.update.length, p.same) : T.tanaPullNone]),
        p.update.length ? el('p', { class: 'meta', 'data-tana-update-names': '' }, [p.update.slice(0, 8).map((u) => u.name).join(', ') + (p.update.length > 8 ? ` +${p.update.length - 8}` : '')]) : null,
        plan && plan.unreadable ? el('p', { class: 'warn' }, [T.tanaPullSkipped(plan.unreadable)]) : null,
        el('div', { class: 'cur-bar' }, [
          changes ? el('button', { class: 'btn btn-electric', 'data-tana-apply': '', onclick: apply }, [T.tanaPullApply(changes)]) : null,
          el('button', { class: 'btn btn-ghost', 'data-tana-cancel': '', onclick: () => { plan = null; draw() } }, [T.tanaPullCancel]),
        ]),
      ]) : null,
    ]
    root.replaceChildren(...parts.filter((n): n is Node => n !== null))
  }
  draw()
  return root
}
