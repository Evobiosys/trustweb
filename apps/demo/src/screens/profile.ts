/**
 * "Mein Profil" -- who this person is, visible only on their own device.
 *
 * This module builds the screen BODY only; main.ts's screenProfile() wraps
 * it in the shared `shell()` chrome and owns navigation. Kept as a separate
 * module, per the handover, so main.ts's own diff stays a few lines.
 *
 * Privacy: nothing here writes into a QueryEnvelope or AnswerEnvelope.
 * gate.ts's GateInput has no `profile` field -- there is no path from this
 * screen to a requester at all in this build, let alone one that skips
 * consent. See test/gate_profile_privacy.test.ts.
 */

import { el } from '../ui/dom'
import { t } from '../i18n'
import type { DeviceState } from '../state'
import { deviceMode, applyModePosture } from '../state'
import { renderModePicker, modeTitleKey } from './mode_picker'
import type { CooldownPolicy } from '../cooldown'
import { RELAY_POSTURE_DEFAULT_ON } from '../relay_posture'
import { DEFAULT_K, HIGH_RISK_TEMPLATE_K } from '@resource-web/network-access/anonymity'
// Subpath import, not the package's default entry: `@resource-web/transport`'s
// barrel (index.ts) also re-exports its Matrix/DIDComm transports, which pull
// in Node-only modules (matrix-bot-sdk, node:module) that Vite cannot bundle
// for the browser. `./inbound_vouch` only reaches vrc.ts/did_identity.ts,
// which have no such dependency -- see packages/transport/package.json's
// `exports` map.
import { VOUCH_K } from '@resource-web/transport/inbound_vouch'

function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
  return el('div', { class: 'field' }, [el('label', {}, [label]), input, hint ? el('small', {}, [hint]) : null])
}

/**
 * `onSave` persists a field edit in place, same as chats.ts's threadRow: no
 * draft state, no explicit save button. `onIdentityChange` additionally
 * asks the caller to redraw the surrounding chrome -- used ONLY by the
 * display-name field, because that is the one field the topbar and the
 * connect screen also read (`state.me.displayName`). The other three fields
 * call `onSave` alone: a full-screen rerender on every blur is a needless
 * risk to in-progress keyboard/tab focus for no visible benefit, since
 * nothing outside this screen shows bio/Grätzl/languages.
 */
export function renderProfile(s: DeviceState, onSave: () => void, onIdentityChange: () => void): HTMLElement {
  const p = s.profile

  const nameInput = el('input', { type: 'text', value: p.displayName }) as HTMLInputElement
  nameInput.addEventListener('change', () => {
    const v = nameInput.value.trim()
    if (!v) { nameInput.value = p.displayName; return } // never let the display name go empty
    // Kept in lockstep with `me.displayName`: the topbar and the connect
    // ceremony both read `me`, and showing one name there while this screen
    // shows another would look like a bug mid-demo, not a feature.
    p.displayName = v
    s.me.displayName = v
    onIdentityChange()
  })

  const bioInput = el('textarea', { rows: 3 }) as HTMLTextAreaElement
  bioInput.value = p.bio
  bioInput.addEventListener('change', () => { p.bio = bioInput.value.trim(); onSave() })

  const graetzlInput = el('input', { type: 'text', value: p.neighbourhood }) as HTMLInputElement
  graetzlInput.addEventListener('change', () => { p.neighbourhood = graetzlInput.value.trim(); onSave() })

  const langsInput = el('input', { type: 'text', value: p.languages.join(', ') }) as HTMLInputElement
  langsInput.addEventListener('change', () => {
    p.languages = langsInput.value
      .split(',')
      .map((x) => x.trim())
      .filter((x) => x.length > 0)
    onSave()
  })

  // The current mode, visible "without hunting for it" (handover's own
  // requirement) -- shown as a heading BEFORE the picker itself, not only
  // implied by which radio happens to be checked, so a person skimming the
  // screen sees it at a glance. Changing it here calls applyModePosture()
  // (state.ts) -- the ONE place a mode bundle actually gets applied -- then
  // re-renders the whole app via onIdentityChange, same as the display-name
  // field above, so the change takes visibly immediately.
  //
  // modeChangeScopeNote, not modePickerNote (main.ts's onboarding screens
  // use that one instead): "you can change this later under My Profile"
  // makes no sense while already ON that screen. What matters HERE is the
  // opposite fact -- Sicher's own copy above promises previously-included
  // content stays hidden "until you switch it on", which is only true going
  // FORWARD from a mode change made here (applyModePosture never touches
  // existing ChatThread.included/InventoryItem.included values) -- I7:
  // never let this screen imply more privacy than switching modes actually
  // delivers.
  const modeSection = el('div', {}, [
    el('h2', {}, [t('modeCurrentLabel') + ': ' + t(modeTitleKey(deviceMode(s)))]),
    el('p', { class: 'note' }, [t('modeChangeScopeNote')]),
    renderModePicker(deviceMode(s), (m) => {
      applyModePosture(s, m)
      onIdentityChange()
    }, 'wot-mode-profile'),
  ])

  // Repeat-ask cooldown (cooldown.ts, 2026-09-06): "keep default cooldown" /
  // "no cooldown" -- a device-wide radio pair, same shape as
  // renderModePicker's own radios just above, but its own small group since
  // it is independent of the onboarding mode. Absent `s.cooldownPolicy`
  // reads as 'default' (I9) -- see cooldown.ts's `CooldownPolicy`.
  const cooldownRadios = (['default', 'off'] as CooldownPolicy[]).map((policy) => {
    const id = `wot-cooldown-${policy}`
    const input = el('input', {
      type: 'radio',
      name: 'wot-cooldown-policy',
      id,
      ...((s.cooldownPolicy ?? 'default') === policy ? { checked: true } : {}),
    }) as HTMLInputElement
    input.addEventListener('change', () => {
      if (!input.checked) return
      s.cooldownPolicy = policy
      onSave()
    })
    return el('label', { for: id, style: 'display:flex;align-items:center;gap:8px' }, [
      input,
      document.createTextNode(t(policy === 'default' ? 'cooldownPolicyDefault' : 'cooldownPolicyOff')),
    ])
  })

  // Per-peer mute (cooldown.ts) and "do not relay for this person"
  // (relay_posture.ts) -- one row per connected peer. Both are additive,
  // reversible, narrower actions than the pre-existing `Peer.blocked`
  // (which this screen does not surface a toggle for at all yet -- out of
  // this feature's scope), offered here because muting/relay posture are
  // exactly the settings this feature adds, not a place to also build a
  // general peer-management screen.
  const peerRows = s.peers.length
    ? s.peers.map((p) => {
        const muteBtn = el('button', {
          class: 'btn quiet',
          onclick: () => { p.muted = !p.muted; onSave(); onIdentityChange() },
        }, [t(p.muted ? 'unmutePeerLabel' : 'mutePeerLabel')])
        const relayInput = el('input', {
          type: 'checkbox',
          id: `wot-norelay-${p.id}`,
          ...(p.doNotRelayFor ? { checked: true } : {}),
        }) as HTMLInputElement
        relayInput.addEventListener('change', () => { p.doNotRelayFor = relayInput.checked; onSave() })
        return el('div', { class: 'card' }, [
          el('p', {}, [el('b', {}, [p.displayName])]),
          el('div', { class: 'btnrow' }, [muteBtn]),
          p.muted ? el('p', { class: 'note' }, [t('mutePeerHint')]) : null,
          el('label', { for: `wot-norelay-${p.id}`, style: 'display:flex;align-items:center;gap:8px' }, [
            relayInput,
            document.createTextNode(t('doNotRelayForLabel')),
          ]),
        ])
      })
    : [el('p', { class: 'note' }, [t('noPeersToManage')])]

  const cooldownSection = el('div', {}, [
    el('h2', {}, [t('cooldownSettingTitle')]),
    el('p', { class: 'note' }, [t('cooldownSettingLead')]),
    ...cooldownRadios,
    ...peerRows,
  ])

  // "Act as relay for others" (relay_posture.ts, 2026-09-06). Absent
  // `s.actAsRelay` reads as RELAY_POSTURE_DEFAULT_ON (true) -- see that
  // constant's own doc comment for why the default is on, restated in the
  // setting's own lead copy (I7: the setting text carries the reason, not
  // only the handover doc).
  const actAsRelayInput = el('input', {
    type: 'checkbox',
    id: 'wot-act-as-relay',
    ...((s.actAsRelay ?? RELAY_POSTURE_DEFAULT_ON) ? { checked: true } : {}),
  }) as HTMLInputElement
  actAsRelayInput.addEventListener('change', () => { s.actAsRelay = actAsRelayInput.checked; onSave() })
  const relaySection = el('div', {}, [
    el('h2', {}, [t('relayPostureSettingTitle')]),
    el('p', { class: 'note' }, [t('relayPostureSettingLead')]),
    el('label', { for: 'wot-act-as-relay', style: 'display:flex;align-items:center;gap:8px' }, [
      actAsRelayInput,
      document.createTextNode(t('actAsRelayLabel')),
    ]),
  ])

  // Anonymity floor (k) settings row (k-standardize pass, 2026-09-06,
  // docs/k-parameters.md). The three constants are read-only: they are
  // fixed workspace/product values, not per-device settings (Jakob's
  // 2026-09-06 ruling: "keep k as is, just standardize them"). Only the
  // test-mode toggle below is writable.
  const kRow = (label: string, value: number, hint: string): HTMLElement =>
    el('div', { class: 'card' }, [
      el('p', {}, [el('b', {}, [label]), document.createTextNode(': ' + value)]),
      el('small', {}, [hint]),
    ])

  const testModeInput = el('input', {
    type: 'checkbox',
    id: 'wot-k-test-mode-single-holder',
    ...(s.testModeSingleHolderMatches ? { checked: true } : {}),
  }) as HTMLInputElement
  testModeInput.addEventListener('change', () => {
    s.testModeSingleHolderMatches = testModeInput.checked
    onSave()
  })

  const kSection = el('div', {}, [
    el('h2', {}, [t('kSettingsTitle')]),
    el('p', { class: 'note' }, [t('kSettingsLead')]),
    kRow(t('kDefaultLabel'), DEFAULT_K, t('kDefaultHint')),
    kRow(t('kHighRiskLabel'), HIGH_RISK_TEMPLATE_K, t('kHighRiskHint')),
    kRow(t('kVouchLabel'), VOUCH_K, t('kVouchHint')),
    el('label', { for: 'wot-k-test-mode-single-holder', style: 'display:flex;align-items:center;gap:8px' }, [
      testModeInput,
      document.createTextNode(t('kTestModeLabel')),
    ]),
    el('small', {}, [t('kTestModeHint')]),
  ])

  return el('div', {}, [
    el('p', { class: 'lead' }, [t('profileLead')]),
    field(t('profileName'), nameInput),
    field(t('profileBio'), bioInput),
    field(t('profileGraetzl'), graetzlInput),
    field(t('profileLangs'), langsInput, t('profileLangsHint')),
    modeSection,
    cooldownSection,
    relaySection,
    kSection,
  ])
}
