// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 33: the receiver's "Intro request" card (intro_link.ts), shared by the opened link and the incoming intro ask. DOM and words only. */
import { el } from '../../demo/src/ui/dom'
import type { IntroLink } from './intro_link'
import { S } from './strings'

export interface IntroCardIo { introduce: () => void; notNow: () => void; decline: () => void }

export function introCard(l: Pick<IntroLink, 'by' | 'target' | 'why'>, io: IntroCardIo): HTMLElement {
  return el('div', { 'data-intro-card': '' }, [
    el('span', { class: 'eyebrow' }, [S.introCardEyebrow]),
    el('h2', { 'data-intro-card-title': '' }, [S.introCardTitle(l.by, l.target)]),
    l.why ? el('p', { class: 'ask-q', 'data-intro-card-why': '' }, [S.introCardWhy(l.why)]) : null,
    el('button', { class: 'btn btn-mint', 'data-intro-do': '', onclick: io.introduce }, [S.introduceBtn]),
    el('button', { class: 'btn btn-ghost', 'data-intro-notnow': '', onclick: io.notNow }, [S.introNotNow]),
    el('button', { class: 'btn btn-ghost', 'data-intro-decline': '', onclick: io.decline }, [S.introDeclineBtn]),
  ])
}
