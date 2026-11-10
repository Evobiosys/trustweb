// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Settings > AI: Claude (the TrustInTheWeb.com subscription: plan cards, sign-up on the device) and, as an indented subsection,
 * Custom (the person's own endpoint: base URL, key, model and a Test button; Ollama on this device and pc24 are presets inside it, wave 39). Kept on this phone and in the sealed record.
 */
import { el } from '../../demo/src/ui/dom'
import { activeEndpoint, apiBase, ENTERPRISE_MAIL, PLAN_CARDS, checkSubscription, pollsOnOpen, devPc24Seed, makeClaim, migrateAi, PLANS, signUp, validEmail, type PlanId } from './ai_subscription'
import { configured, CUSTOM_PRESETS, customPreset, customPresetOf, onWake, testEndpoint, testResultLines, type WakeEvent } from './llm_endpoint'
import type { AiEndpoint, AppState } from './model'
import { S } from './strings'

const net: Parameters<typeof signUp>[0] = (url, init) => fetch(url, init)
/** One poll per open, not a timer: a draw within this window of the last poll does not ask again. */
const POLL_GAP_MS = 30_000
let lastPoll = 0
let quota: { used?: number; quota: number } | null = null

export interface AiViewHooks {
  state: () => AppState
  save: () => void
  toast: (msg: string) => void
  openSheet: (children: (Node | null)[]) => void
  /** Closes the sign-up sheet and shows Settings again, as it was left. */
  backToSettings: () => void
}

/** Polls the pending (or active) sign-up once and stores the result; never throws. True when the record changed. */
async function pollOnce(h: Pick<AiViewHooks, 'state' | 'save'>): Promise<boolean> {
  const ai = h.state().advanced?.ai
  if (!ai?.sub || ai.sub.state === 'revoked') return false
  lastPoll = Date.now()
  try {
    const r = await checkSubscription(net, apiBase(), ai)
    const was = JSON.stringify(ai)
    ;(h.state().advanced ??= {}).ai = r.ai
    if (r.quota !== undefined) quota = { used: r.used, quota: r.quota }
    if (JSON.stringify(r.ai) === was) return false
    h.save()
    return true
  } catch { return false }
}

/** App start: a legacy pc24 record becomes a custom one, Jakob's dev record gets pc24 as Custom, a pending sign-up is polled once. */
/** The loading window while the server's AI computer wakes (llm_endpoint's onWake): a spinner, the wait so far, a way to hide it. */
export function mountWakeWindow(doc: Document = document): void {
  let box: HTMLElement | null = null
  const close = (): void => { box?.remove(); box = null }
  onWake((e: WakeEvent) => {
    if (e.phase === 'ready') return close()
    if (!box) {
      box = el('div', { class: 'wt-modal ai-wake', role: 'status', 'aria-live': 'polite', 'data-ai-wake': '' }, [])
      doc.body.append(box)
    }
    const msg = e.phase === 'failed' ? S.aiWakeFailed : S.aiWakeBody
    box.replaceChildren(el('div', { class: 'wt-panel ai-wake-panel' }, [
      ...(e.phase === 'waiting' ? [el('div', { class: 'ai-wake-spin', 'aria-hidden': 'true' }, [])] : []),
      el('h3', {}, [S.aiWakeTitle]),
      el('p', {}, [msg]),
      ...(e.phase === 'waiting' ? [el('p', { class: 'meta', 'data-ai-wake-waited': '' }, [S.aiWakeWaited(e.waited)])] : []),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-ai-wake-hide': '', onclick: close }, [S.aiWakeHide]),
    ]))
  })
}

export function bootAi(h: Pick<AiViewHooks, 'state' | 'save'> & { dev: boolean }): void {
  mountWakeWindow()
  const s = h.state()
  const was = s.advanced?.ai
  const ai = migrateAi(was)
  if (ai !== was) { (s.advanced ??= {}).ai = ai; h.save() }
  if (!ai && h.dev) { (s.advanced ??= {}).ai = devPc24Seed(); h.save() }
  if (ai?.sub?.state === 'pending') void pollOnce(h)
}

export function aiSettings(h: AiViewHooks): HTMLElement[] {
  const box = el('div', { class: 'channels', 'data-ai': '' })
  const ai = (): AiEndpoint => {
    const a = h.state()
    return (a.advanced ??= {}).ai = migrateAi(a.advanced.ai) ?? { preset: 'custom', baseUrl: '', apiKey: '', model: '' }
  }
  let byokOpen = configured(h.state().advanced?.ai) && h.state().advanced?.ai?.preset !== 'tw-subscription'
  const field = (key: 'baseUrl' | 'apiKey' | 'model' | 'name', label: string, type: string): HTMLElement => {
    const input = el('input', { class: 'field', type, placeholder: label, 'aria-label': label, value: ai()[key] ?? '', autocomplete: 'off', 'data-ai-field': key }) as HTMLInputElement
    input.addEventListener('change', () => { ai()[key] = input.value.trim(); h.save(); if (key === 'name') draw() })
    return input
  }

  const signUpSheet = (id: PlanId): void => {
    const email = el('input', { class: 'field', type: 'email', placeholder: S.aiSubEmail, 'aria-label': S.aiSubEmail, autocomplete: 'email', 'data-ai-email': '' }) as HTMLInputElement
    const err = el('p', { class: 'meta ai-error', 'data-ai-signup-error': '', role: 'alert' })
    const send = el('button', {
      class: 'btn btn-sm', 'data-ai-sent': '',
      onclick: async () => {
        err.textContent = ''
        if (!validEmail(email.value)) { err.textContent = S.aiSubEmailBad; return }
        const claim = makeClaim()
        send.setAttribute('disabled', '')
        send.textContent = S.aiSubSending
        try {
          const r = await signUp(net, apiBase(), { plan: id, email: email.value, claim })
          ai().sub = { plan: id, ref: r.ref, email: email.value.trim(), claim, state: 'pending' }
          h.save(); h.backToSettings()
        } catch (e) {
          err.textContent = (e as Error).message
          send.removeAttribute('disabled')
          send.textContent = S.aiSubSent
        }
      },
    }, [S.aiSubSent])
    h.openSheet([
      el('button', { class: 'btn btn-ghost btn-sm ai-back', type: 'button', 'data-ai-back': '', onclick: () => h.backToSettings() }, ['← ' + S.back]),
      el('h3', {}, [S.aiSubSheetTitle(S.aiSubPlans[id])]),
      el('p', {}, [S.aiSubWise(PLANS[id].euro)]),
      email, err, send,
    ])
  }

  const subGroup = (): HTMLElement => {
    const sub = ai().sub
    const canSignUp = !sub || sub.state === 'revoked'
    const card = (c: (typeof PLAN_CARDS)[number]): HTMLElement => {
      const text = S.aiPlanCards[c.id]
      const action = c.id === 'enterprise'
        ? el('a', { class: 'btn btn-sm ai-plan-btn', href: ENTERPRISE_MAIL, 'data-ai-enterprise': '' }, [text.button!])
        : canSignUp ? el('button', { class: 'btn btn-sm ai-plan-btn', 'data-ai-signup': c.id, onclick: () => signUpSheet(c.id as PlanId) }, [S.aiPlanChoose(text.name)]) : null
      return el('div', { class: 'ai-plan', 'data-ai-plan': c.id }, [
        el('h6', { class: 'ai-plan-name' }, [text.name]),
        el('p', { class: 'ai-plan-price' }, [text.price]),
        ...(c.euro === null ? [] : [el('p', { class: 'meta' }, [S.aiPlanPerMonth])]),
        ...text.lines.map((l) => el('p', { class: 'meta' }, [l])),
        ...(c.euro === null ? [] : [el('p', { class: 'meta' }, [S.aiSubQuota(PLANS[c.id as PlanId].quota)])]),
        action,
      ])
    }
    const state = sub && sub.state !== 'revoked' ? el('div', { 'data-ai-sub-state': sub.state }, [
      el('p', { class: 'meta' }, [sub.state === 'pending' ? S.aiSubPending : S.aiSubActive(quota?.used, quota?.quota ?? PLANS[sub.plan].quota)]),
      ...(sub.state === 'pending' ? [
        el('p', { class: 'meta' }, [S.aiSubRef(sub.ref)]),
        el('button', {
          class: 'btn btn-ghost btn-sm', 'data-ai-check-now': '',
          onclick: async (ev: Event) => { (ev.currentTarget as HTMLElement).textContent = S.aiSubChecking; await pollOnce(h); draw() },
        }, [S.aiSubCheck]),
      ] : sub.token && ai().preset !== 'tw-subscription' ? [
        el('button', { class: 'btn btn-ghost btn-sm', 'data-ai-use-sub': '', onclick: () => { h.state().advanced!.ai = { ...activeEndpoint(apiBase(), sub.token!), sub }; h.save(); draw() } }, [S.aiSubUse]),
      ] : []),
    ]) : sub ? el('p', { class: 'meta', 'data-ai-sub-state': 'revoked' }, [S.aiSubRevoked]) : null
    return el('div', { class: 'ai-group', 'data-ai-group': 'sub' }, [
      el('h5', { class: 'eyebrow' }, [S.aiClaudeTitle]),
      el('p', { class: 'meta' }, [S.aiSubTitle]),
      el('h4', { class: 'ai-plans-title' }, [S.aiPlansTitle]),
      el('div', { class: 'ai-plans' }, PLAN_CARDS.map(card)),
      el('p', { class: 'meta', 'data-ai-plan-text': '' }, [`${S.aiSubUses} ${S.aiSubPrivacy}`]),
      state,
    ])
  }

  const byokGroup = (): HTMLElement => {
    const cur = ai().preset
    const own = cur !== 'tw-subscription'
    const picked = customPresetOf(ai())
    const result = el('div', { class: 'ai-test-result', 'data-ai-test-result': '', role: 'status' })
    const d = el('details', { class: 'ai-group ai-byok', 'data-ai-group': 'byok' }, [
      el('summary', { class: 'ai-byok-toggle' }, [S.aiCustomTitle]),
      el('p', { class: 'meta' }, [S.aiCustomLead]),
      ...CUSTOM_PRESETS.map((p) => el('button', {
        class: 'radio' + (own && picked === p.id ? ' on' : ''), 'aria-pressed': String(own && picked === p.id), 'data-ai-preset': p.id,
        onclick: () => { h.state().advanced!.ai = customPreset(ai(), p.id); h.save(); draw() },
      }, [el('b', {}, [S.aiCustomPresets[p.id]])])),
      ...(own ? [
        field('name', S.aiName, 'text'),
        field('baseUrl', S.aiBaseUrl, 'url'), field('apiKey', S.aiKey, 'password'), field('model', S.aiModel, 'text'),
        el('button', {
          class: 'btn btn-ghost btn-sm', 'data-ai-test': '1',
          onclick: async () => {
            if (!configured(h.state().advanced?.ai)) { result.replaceChildren(el('p', { class: 'meta' }, [S.aiNotSet])); return }
            result.replaceChildren(el('p', { class: 'meta' }, [S.aiTesting]))
            result.replaceChildren(...testResultLines(await testEndpoint(ai())).map((l) => el('p', { class: `ai-test-${l.kind}${l.ok === undefined ? '' : l.ok ? ' ok' : ' bad'}`, 'data-ai-test-line': l.kind }, [(l.kind === 'status' ? (l.ok ? '✓ ' : '✗ ') : '') + l.text])))
          },
        }, [S.aiTest]),
        result,
      ] : []),
    ]) as HTMLDetailsElement
    d.open = byokOpen
    d.addEventListener('toggle', () => { byokOpen = d.open })
    return d
  }

  const draw = (): void => {
    box.replaceChildren(el('h4', { class: 'eyebrow' }, [S.aiTitle]), subGroup(), byokGroup(), el('p', { class: 'meta' }, [S.aiHint]))
  }
  draw()
  if (pollsOnOpen(h.state().advanced?.ai?.sub) && Date.now() - lastPoll > POLL_GAP_MS) void pollOnce(h).then((changed) => { if (changed) draw() })
  return [box]
}
