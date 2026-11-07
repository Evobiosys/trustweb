// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Settings > Advanced > Your AI: the TrustInTheWeb.com subscription (sign-up on the device) and the person's own keys (OpenAI, Claude,
 * Ollama, Custom), each with base URL, key, model and a Test button. Kept on this phone and in the sealed record.
 */
import { el } from '../../demo/src/ui/dom'
import { activeEndpoint, apiBase, checkSubscription, devPc24Seed, makeClaim, migrateAi, PLANS, presetLabel, signUp, validEmail, type PlanId } from './ai_subscription'
import { askEndpoint, configured, PRESETS } from './llm_endpoint'
import type { AiEndpoint, AppState } from './model'
import { S } from './strings'

const net: Parameters<typeof signUp>[0] = (url, init) => fetch(url, init)
const BYOK = ['openai', 'claude', 'ollama', 'custom'] as const
const PLAN_IDS = Object.keys(PLANS) as PlanId[]
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
export function bootAi(h: Pick<AiViewHooks, 'state' | 'save'> & { dev: boolean }): void {
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
  let plan: PlanId | null = h.state().advanced?.ai?.sub?.plan ?? null
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
      el('h3', {}, [S.aiSubSheetTitle(S.aiSubPlans[id])]),
      el('p', {}, [S.aiSubWise(PLANS[id].euro)]),
      email, err, send,
    ])
  }

  const subGroup = (): HTMLElement => {
    const sub = ai().sub
    const pick = (id: PlanId): HTMLElement => el('button', {
      class: 'radio' + (plan === id ? ' on' : ''), 'aria-pressed': String(plan === id), 'data-ai-plan': id,
      onclick: () => { plan = id; draw() },
    }, [el('b', {}, [S.aiSubPlans[id]])])
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
      el('h5', { class: 'eyebrow' }, [S.aiSubTitle]),
      ...PLAN_IDS.map(pick),
      ...(plan ? [
        el('p', { class: 'meta', 'data-ai-plan-text': plan }, [`${S.aiSubUses} ${S.aiSubQuota(PLANS[plan].quota)} ${S.aiSubPrivacy}`]),
        ...(!sub || sub.state === 'revoked' ? [el('button', { class: 'btn btn-sm', 'data-ai-signup': '', onclick: () => signUpSheet(plan!) }, [S.aiSubSignUp])] : []),
      ] : []),
      state,
    ])
  }

  const byokGroup = (): HTMLElement => {
    const cur = ai().preset
    const result = el('p', { class: 'meta', 'data-ai-result': '' })
    return el('div', { class: 'ai-group', 'data-ai-group': 'byok' }, [
      el('h5', { class: 'eyebrow' }, [S.aiByokTitle]),
      ...BYOK.map((p) => el('button', {
        class: 'radio' + (cur === p ? ' on' : ''), 'aria-pressed': String(cur === p), 'data-ai-preset': p,
        onclick: () => { Object.assign(ai(), { preset: p, ...PRESETS[p] }); h.save(); draw() },
      }, [el('b', {}, [p === 'custom' && cur === 'custom' ? presetLabel(ai()) : S.aiPreset[p]])])),
      ...(cur === 'tw-subscription' ? [] : [
        ...(cur === 'custom' ? [field('name', S.aiName, 'text')] : []),
        field('baseUrl', S.aiBaseUrl, 'url'), field('apiKey', S.aiKey, 'password'), field('model', S.aiModel, 'text'),
        el('button', {
          class: 'btn btn-ghost btn-sm', 'data-ai-test': '1',
          onclick: async () => {
            if (!configured(h.state().advanced?.ai)) { result.textContent = S.aiNotSet; return }
            result.textContent = S.aiTesting
            try { await askEndpoint(ai(), 'I want to play padel'); result.textContent = S.aiOk } catch (e) { result.textContent = S.aiError((e as Error).message) }
          },
        }, [S.aiTest]),
        result,
      ]),
    ])
  }

  const draw = (): void => {
    box.replaceChildren(el('h4', { class: 'eyebrow' }, [S.aiTitle]), subGroup(), byokGroup(), el('p', { class: 'meta' }, [S.aiHint]))
  }
  draw()
  if (h.state().advanced?.ai?.sub?.state === 'pending' && Date.now() - lastPoll > POLL_GAP_MS) void pollOnce(h).then((changed) => { if (changed) draw() })
  return [box]
}
