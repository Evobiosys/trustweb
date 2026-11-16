// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 feed-sources (Jakob β): the Sources page (a sheet, opened from the Feed and from Settings > Feed): three sections of sources with an
 * on/off switch (off = struck through, P2), filters behind an expander (P3, optional inputs greyed and small, P7), the "Never read public
 * content" switch and the ranking sliders with their plain-language sentence. Every change is stored at once; nothing is ever published.
 * The model is feed_sources_page.ts; the Feed list applies it (feed_view.ts).
 */
import { el } from '../../demo/src/ui/dom'
import { ALGO_DEFAULT, algoOf, algoParts, setAlgo, setNoPublicRead, setSource, SOURCES, sourceCfg, sourceOn } from './feed_sources_page'
import type { AlgoCfg, FeedCfg, SourceGroup } from './feed_sources_page'
import type { AppState } from './model'
import { S } from './strings'

export interface SourcesViewHooks {
  state: () => AppState
  save: () => void
  openSheet: (children: (Node | null)[]) => void
}

const T = S.w44sources
const SECTIONS: readonly SourceGroup[] = ['techno', 'alt', 'open']

/** The slider values in words: "Newest first, people you trust a bit higher, ...". */
export function explainAlgo(a: Pick<AlgoCfg, 'recency' | 'trust' | 'source'>): string {
  const parts = algoParts(a).map((p) => T.algoPart[p.key][p.level])
  if (!parts.length) return T.algoNone
  const text = parts.join(', ')
  return `${text[0].toUpperCase()}${text.slice(1)}.`
}

export function createSourcesView(h: SourcesViewHooks): { open: () => void; body: () => HTMLElement } {
  const cfg = (): FeedCfg => {
    const s = h.state()
    s.feed = typeof s.feed === 'object' && s.feed !== null ? s.feed : {}
    return s.feed
  }
  const opened = new Set<string>()

  function slider(label: string, value: number, attr: string, change: (v: number) => void): HTMLElement {
    const input = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(value), 'aria-label': label, [attr]: '1', class: 'algo-range' }) as HTMLInputElement
    input.addEventListener('input', () => change(Number(input.value)))
    return el('label', { class: 'algo-row' }, [el('span', { class: 'meta' }, [label]), input])
  }

  function row(id: string, discouraged: boolean): HTMLElement {
    const name = T.name[id] ?? id
    const c = sourceCfg(cfg(), id)
    const on = sourceOn(cfg(), id)
    const sw = el('button', { class: 'radio' + (on ? ' on' : ' tw-off'), type: 'button', 'aria-pressed': String(on), 'data-source-toggle': id, onclick: () => {
      const now = !sourceOn(cfg(), id)
      setSource(cfg(), id, { on: now }); h.save()
      sw.className = 'radio' + (now ? ' on' : ' tw-off'); sw.setAttribute('aria-pressed', String(now))
    } }, [el('b', {}, [name]), el('small', {}, [T.note[id] ?? ''])])
    const chip = (label: string, attr: string, get: () => boolean, set: (v: boolean) => void): HTMLElement => {
      const b = el('button', { class: 'chip' + (get() ? ' on' : ''), type: 'button', 'aria-pressed': String(get()), [attr]: id, onclick: () => { set(!get()); h.save(); b.className = 'chip' + (get() ? ' on' : ''); b.setAttribute('aria-pressed', String(get())) } }, [label])
      return b
    }
    const mute = el('input', { class: 'field src-opt', placeholder: T.mute, 'aria-label': T.mute, autocomplete: 'off', value: (c.mute ?? []).join(', '), 'data-source-mute': id }) as HTMLInputElement
    mute.addEventListener('change', () => { setSource(cfg(), id, { mute: mute.value.split(',') }); h.save() })
    const weight = slider(T.sourceWeight, algoOf(cfg()).perSource?.[id] ?? 0.5, 'data-source-weight', (v) => { setAlgo(cfg(), { perSource: { ...algoOf(cfg()).perSource, [id]: v } }); h.save() })
    const panel = el('div', { class: 'src-filters', 'data-source-filters': id, role: 'group', 'aria-label': T.filtersLabel(name) }, [
      el('div', { class: 'feed-chips' }, [
        chip(T.trustedOnly, 'data-source-trusted', () => sourceCfg(cfg(), id).trustedOnly === true, (v) => setSource(cfg(), id, { trustedOnly: v })),
        chip(T.publicAllowed, 'data-source-public', () => sourceCfg(cfg(), id).publicAllowed !== false, (v) => setSource(cfg(), id, { publicAllowed: v })),
      ]),
      mute, weight,
    ])
    panel.hidden = !opened.has(id)
    const toggle = el('button', { class: 'tw-expander', type: 'button', 'aria-expanded': String(!panel.hidden), 'aria-label': T.filtersLabel(name), 'data-source-expander': id, onclick: () => {
      if (opened.has(id)) opened.delete(id); else opened.add(id)
      panel.hidden = !opened.has(id); toggle.setAttribute('aria-expanded', String(!panel.hidden)); toggle.textContent = panel.hidden ? '▾' : '▴'
    } }, [panel.hidden ? '▾' : '▴'])
    return el('div', { class: 'src-row' + (discouraged ? ' src-discouraged' : ''), 'data-source': id }, [el('div', { class: 'src-main' }, [sw, toggle]), panel])
  }

  function body(): HTMLElement {
    const a = algoOf(cfg())
    const say = el('p', { class: 'meta', 'data-algo-explain': '1', 'aria-live': 'polite' }, [explainAlgo(a)])
    const algoSlider = (key: 'recency' | 'trust' | 'source', label: string): HTMLElement => slider(label, a[key], `data-algo-${key}`, (v) => {
      setAlgo(cfg(), { [key]: v }); h.save(); say.textContent = explainAlgo(algoOf(cfg()))
    })
    const noPublic = el('button', { class: 'radio' + (cfg().noPublicRead ? ' on' : ' tw-off'), type: 'button', 'aria-pressed': String(cfg().noPublicRead === true), 'data-sources-nopublic': '1', onclick: () => {
      const now = cfg().noPublicRead !== true
      setNoPublicRead(cfg(), now); h.save()
      noPublic.className = 'radio' + (now ? ' on' : ' tw-off'); noPublic.setAttribute('aria-pressed', String(now))
    } }, [el('b', {}, [T.noPublic]), el('small', {}, [T.noPublicHint])])
    return el('div', { class: 'sources-page', 'data-sources-page': '1' }, [
      el('h3', {}, [T.title]),
      el('p', { class: 'meta' }, [T.intro]),
      noPublic,
      ...SECTIONS.flatMap((g) => [
        el('h4', { class: 'eyebrow', 'data-sources-section': g }, [T.section[g]]),
        el('p', { class: 'meta' }, [T.sectionHint[g]]),
        ...SOURCES.filter((s) => s.group === g).map((s) => row(s.id, s.discouraged === true)),
      ]),
      el('h4', { class: 'eyebrow', 'data-sources-section': 'algo' }, [T.algoTitle]),
      algoSlider('recency', T.algoRecency), algoSlider('trust', T.algoTrust), algoSlider('source', T.algoSource),
      say,
      el('p', { class: 'meta src-opt' }, [`${ALGO_DEFAULT.recency} / ${ALGO_DEFAULT.trust} / ${ALGO_DEFAULT.source}`]),
    ])
  }

  return { open: () => h.openSheet([body()]), body }
}
