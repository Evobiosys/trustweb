// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 mcp-local: the rows under Settings > Extensions > MCP & agents (what the dynamic import yields). Settings and servers stay on this device (localStorage). */
import { el } from '../../../../demo/src/ui/dom'
import { alphaSub } from '../../alpha_heading'
import type { TwCtx, TwModuleBody } from '../tw_registry'
import { callableForImport, contactsFromResult, openSession, pushArgs, pushableTools, type McpSession } from './mcp_client'
import { CLIENTS, MCP_TOOLS, SERVERS_KEY, SETTINGS_KEY, SUMBIOS_ID, parseServers, parseSettings, removeServer, piFallback, snippet, upsertServer, validUrl, type ClientId, type McpInfo, type McpServerEntry, type McpSettings } from './mcp_config'

const store = (): Storage | null => { try { return localStorage } catch { return null } }
const loadSettings = (): McpSettings => parseSettings(store()?.getItem(SETTINGS_KEY) ?? null)
const loadServers = (): McpServerEntry[] => parseServers(store()?.getItem(SERVERS_KEY) ?? null)
const put = (key: string, v: unknown): void => { try { store()?.setItem(key, JSON.stringify(v)) } catch { /* browser refused: the choice is kept until the page closes */ } }
const fetchFn = (url: string, init: RequestInit) => fetch(url, init)
const link = (label: string, onclick: () => void, attrs: Record<string, string> = {}): HTMLButtonElement => el('button', { class: 'btn btn-ghost mcp-link', type: 'button', ...attrs, onclick }, [label])

/** One client's command (or block) with a copy button; pi also gets its fallback text. `info` is what the dev server says about this checkout. */
function clientBlock(id: ClientId, ctx: TwCtx, s: McpSettings, info: McpInfo): HTMLElement {
  const t = ctx.strings.mcp
  const text = snippet(id, s, info.server, info.record)
  const copied = el('small', { class: 'meta', hidden: true }, [t.copied])
  const fallback = id === 'pi' ? piFallback(s, info.server, info.record) : ''
  return el('details', { class: 'mcp-client', 'data-mcp-client': id, ...(id === 'pi' || id === 'claude-code' ? { open: '' } : {}) }, [
    el('summary', { class: 'mcp-summary' }, [t.clients[id]]),
    el('p', { class: 'meta' }, [t.where[id]]),
    el('pre', { class: 'mcp-snippet', 'data-mcp-snippet': id }, [text]),
    link(ctx.strings.mcpLive.copyCommand, () => { void navigator.clipboard?.writeText(text).then(() => { copied.hidden = false }) }, { 'data-mcp-copy': id }),
    copied,
    ...(fallback ? [
      el('p', { class: 'meta' }, [ctx.strings.mcpLive.piFallbackTitle]),
      el('pre', { class: 'mcp-snippet', 'data-mcp-snippet': 'pi-fallback' }, [fallback]),
      link(t.copy, () => { void navigator.clipboard?.writeText(fallback) }, { 'data-mcp-copy': 'pi-fallback' }),
    ] : []),
  ])
}

function serverBlock(e: McpServerEntry, ctx: TwCtx, redraw: () => void): HTMLElement {
  const t = ctx.strings.mcp
  const url = el('input', { class: 'field', value: e.url, placeholder: e.id === SUMBIOS_ID ? t.sumbiosUrl : t.serverUrl, 'aria-label': t.serverUrl, 'data-mcp-url': e.id }) as HTMLInputElement
  const token = el('input', { class: 'field', type: 'password', value: e.token, 'aria-label': t.serverToken, autocomplete: 'off', 'data-mcp-token': e.id }) as HTMLInputElement
  const name = el('input', { class: 'field', value: e.name, 'aria-label': t.serverName, 'data-mcp-name': e.id }) as HTMLInputElement
  const status = el('p', { class: 'meta', 'data-mcp-status': e.id, role: 'status' }, [])
  const work = el('div', { class: 'mcp-work' }, [])
  const say = (msg: string): void => { status.textContent = msg }
  const save = (): void => {
    const next = { ...e, name: name.value.trim() || e.name, url: url.value.trim(), token: token.value.trim() }
    try { put(SERVERS_KEY, upsertServer(loadServers(), next)); say(t.saved); redraw() } catch { say(t.badUrl) }
  }
  const connect = async (): Promise<void> => {
    if (!validUrl(url.value.trim())) { say(t.badUrl); return }   // review wave 40: the key never goes to an address Save refuses
    say(t.connecting)
    try { drawWork(await openSession({ ...e, url: url.value.trim(), token: token.value.trim() }, fetchFn)); say('') } catch (err) { say(t.connectFailed(err instanceof Error ? err.message : String(err))) }
  }

  function drawWork(session: McpSession): void {
    const reads = callableForImport(session.tools)
    const pushes = pushableTools(session.tools)
    const pick = (tools: { name: string }[], mark: string): HTMLSelectElement => el('select', { 'data-mcp-tool': mark, 'aria-label': mark }, tools.map((x) => el('option', { value: x.name }, [x.name]))) as HTMLSelectElement
    const readPick = pick(reads, 'in')
    const pushPick = pick(pushes, 'out')
    const find = el('input', { class: 'field', placeholder: t.findPerson, 'aria-label': t.findPerson, 'data-mcp-find': e.id }) as HTMLInputElement
    const chosen = new Set<string>()
    const list = el('div', { class: 'mcp-people', 'data-mcp-people': '' }, [])
    const sendBtn = link('', () => { void send() }, { 'data-mcp-send': e.id })
    const refreshBtn = (): void => { sendBtn.textContent = t.sendBtn(chosen.size); sendBtn.hidden = chosen.size === 0 }
    const drawPeople = (): void => {
      const q = find.value.trim().toLowerCase()
      const people = ctx.store().people.filter((p) => p.deleted_at === undefined && q !== '' && p.name.toLowerCase().includes(q)).slice(0, 30)
      list.replaceChildren(...people.map((p) => el('label', { class: 'mcp-person' }, [
        el('input', { type: 'checkbox', 'data-mcp-person': p.id, ...(chosen.has(p.id) ? { checked: '' } : {}), onchange: (ev: Event) => { if ((ev.target as HTMLInputElement).checked) chosen.add(p.id); else chosen.delete(p.id); refreshBtn() } }),
        ' ', p.name,
      ])))
    }
    find.addEventListener('input', drawPeople)
    async function send(): Promise<void> {
      const tool = pushes.find((x) => x.name === pushPick.value)
      if (!tool) return
      let ok = 0
      let failed = 0
      for (const p of ctx.store().people.filter((x) => chosen.has(x.id))) {
        const args = pushArgs(tool, p)
        try { if (!args) throw new Error('no name'); await session.call(tool.name, args); ok++ } catch { failed++ }
      }
      chosen.clear(); refreshBtn(); drawPeople(); say(t.sendDone(ok, failed))
    }
    refreshBtn()
    work.replaceChildren(
      el('h5', { class: 'eyebrow' }, [t.bringIn]), el('p', { class: 'meta' }, [t.bringInHint]),
      ...(reads.length ? [readPick, link(t.readPeople, () => {
        void session.call(readPick.value, {}).then((r) => {
          const { contacts, skipped } = contactsFromResult(r, e.name)
          say(t.readCount(contacts.length, skipped))
          if (contacts.length) ctx.bus.emit('import-contacts', { contacts, name: e.name })
        }).catch((err: unknown) => say(t.connectFailed(err instanceof Error ? err.message : String(err))))
      }, { 'data-mcp-read': e.id })] : [el('p', { class: 'meta' }, [t.noImportTool])]),
      el('h5', { class: 'eyebrow' }, [t.sendOut]), el('p', { class: 'meta' }, [t.sendHint]),
      ...(pushes.length ? [pushPick, find, list, sendBtn] : [el('p', { class: 'meta' }, [t.noPushTool])]),
    )
  }

  return el('div', { class: 'mcp-server', 'data-mcp-server': e.id }, [
    el('label', { class: 'meta' }, [t.serverName, ' ', name]),
    el('label', { class: 'meta' }, [t.serverUrl, ' ', url]),
    el('label', { class: 'meta' }, [t.serverToken, ' ', token]),
    el('div', { class: 'mcp-row' }, [
      link(t.save, save, { 'data-mcp-save': e.id }),
      link(t.connect, () => { void connect() }, { 'data-mcp-connect': e.id }),
      link(e.id === SUMBIOS_ID ? t.clear : t.remove, () => { put(SERVERS_KEY, removeServer(loadServers(), e.id)); redraw() }, { 'data-mcp-remove': e.id }),
    ]),
    status, work,
  ])
}

/** GET /__tw/mcp-info (dev server only): the absolute path of this checkout's MCP program. null elsewhere: a page cannot know it. */
async function loadInfo(): Promise<McpInfo | null> {
  try {
    const r = await fetch('/__tw/mcp-info', { cache: 'no-store' })
    const j = r.ok ? ((await r.json()) as Partial<McpInfo>) : null
    return j && typeof j.server === 'string' && j.server.startsWith('/') ? { server: j.server, ...(typeof j.record === 'string' ? { record: j.record } : {}) } : null
  } catch { return null }
}

function rows(ctx: TwCtx): Node[] {
  const t = ctx.strings.mcp
  const box = el('div', { class: 'mcp-settings', 'data-mcp-settings': '' }, [])
  let info: McpInfo | null = null
  void loadInfo().then((i) => { info = i; draw() })
  const draw = (): void => {
    const s = loadSettings()
    const change = (next: McpSettings): void => { put(SETTINGS_KEY, next); draw() }
    const toolRow = (tool: { name: string; write: boolean }): HTMLElement => {
      const on = !s.off.includes(tool.name)
      return el('label', { class: 'mcp-tool' + (tool.write && !s.write ? ' mcp-tool-idle' : ''), 'data-mcp-tool-row': tool.name }, [
        el('input', { type: 'checkbox', ...(on ? { checked: '' } : {}), onchange: (ev: Event) => change({ ...s, off: (ev.target as HTMLInputElement).checked ? s.off.filter((n) => n !== tool.name) : [...s.off, tool.name] }) }),
        ' ', el('b', {}, [tool.name]), ' ', el('small', {}, [t.tools[tool.name] + (tool.write ? ` (${t.toolWrites})` : '')]),
      ])
    }
    const main = CLIENTS.filter((c) => !c.others)
    const others = CLIENTS.filter((c) => c.others)
    box.replaceChildren(
      el('p', { class: 'meta' }, [t.lead, ' ', alphaSub()]),
      el('button', { class: 'radio' + (s.write ? ' on' : ''), role: 'switch', 'aria-checked': String(s.write), 'data-mcp-write': '', onclick: () => change({ ...s, write: !s.write }) }, [el('b', {}, [t.writeTitle]), el('small', {}, [t.writeHint])]),
      el('h5', { class: 'eyebrow' }, [t.toolsTitle]), el('p', { class: 'meta' }, [t.toolsHint]),
      ...MCP_TOOLS.map(toolRow),
      el('button', { class: 'radio' + (ctx.store().mcpApplyDirectly ? ' on' : ''), role: 'switch', 'aria-checked': String(ctx.store().mcpApplyDirectly === true), 'data-mcp-direct': '', onclick: () => { ctx.store().mcpApplyDirectly = ctx.store().mcpApplyDirectly ? undefined : true; ctx.save?.(); draw() } }, [el('b', {}, [ctx.strings.mcpLive.directTitle]), el('small', {}, [ctx.strings.mcpLive.directHint])]),
      el('h5', { class: 'eyebrow' }, [ctx.strings.mcpLive.commandTitle]),
      ...(s.write ? [] : [el('p', { class: 'meta', 'data-mcp-writes-off': '' }, [ctx.strings.mcpLive.writesOff])]),
      ...(info ? [el('p', { class: 'meta' }, [t.pathHint]), ...main.map((c) => clientBlock(c.id, ctx, s, info!)),
        el('h5', { class: 'eyebrow', 'data-mcp-others': '' }, [t.othersTitle]),
        ...others.map((c) => clientBlock(c.id, ctx, s, info!))] : [el('p', { class: 'meta', 'data-mcp-need-dev': '' }, [ctx.strings.mcpLive.needDev])]),
      el('h5', { class: 'eyebrow' }, [t.serversTitle]), el('p', { class: 'meta' }, [t.serversHint]),
      ...loadServers().map((e) => serverBlock(e, ctx, draw)),
      link(t.addServer, () => { put(SERVERS_KEY, upsertServer(loadServers(), { id: `srv-${Date.now().toString(36)}`, name: t.newName, url: '', token: '' })); draw() }, { 'data-mcp-add-server': '' }),
    )
  }
  draw()
  return [box]
}

export const body: TwModuleBody = {
  settings: (ctx) => [{ id: 'mcp-local', title: ctx.strings.mcp.title, rows: () => rows(ctx) }],
}
