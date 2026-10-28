/**
 * Chat view (src/chat_view.ts, wave 6 U3). No DOM library is installed in the
 * workspace (and none may be added), so the view runs against a tiny fake
 * document that implements exactly what the view uses. That is enough to prove
 * the structure, the safe text handling and the send / retry flow; real browser
 * rendering is for the e2e run once the hooks are wired.
 */
import { MessageState, emptyBook, queueOutgoing, receiveText } from '../../src/chat.ts'
import { ThreadStatus, chatViewModel, flushPending, injectChatStyles, renderChat, renderShareControls, safeHref, submitText } from '../../src/chat_view.ts'
import { Channel } from '../../src/model.ts'

class FakeNode {
  constructor(tag) { this.tagName = tag; this.attrs = {}; this.children = []; this.listeners = {}; this.value = ''; this.disabled = false; this.scrollTop = 0; this.scrollHeight = 0 }
  setAttribute(k, v) { this.attrs[k] = v }
  append(...kids) { this.children.push(...kids) }
  replaceChildren(...kids) { this.children = kids }
  addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn) }
  fire(t, ev = {}) { return Promise.all((this.listeners[t] ?? []).map((fn) => fn(ev))) }
  set textContent(v) { this.children = v === '' ? [] : [{ text: String(v) }] }
  get textContent() { return this.children.map((c) => (c.text !== undefined ? c.text : c.textContent)).join('') }
  find(pred, out = []) { for (const c of this.children) if (c.tagName) { if (pred(c)) out.push(c); c.find(pred, out) } return out }
  byClass(cls) { return this.find((n) => (n.attrs.class ?? '').split(' ').includes(cls)) }
  byTag(tag) { return this.find((n) => n.tagName === tag) }
}
const makeDoc = () => {
  const head = new FakeNode('head')
  return {
    head,
    createElement: (t) => new FakeNode(t),
    createTextNode: (text) => ({ text }),
    getElementById: (id) => head.find((n) => n.attrs.id === id)[0] ?? null,
  }
}

const USER = 'https://signal.me/#eu/abcDEF123_-xyz'
const reach = { channel: Channel.Signal, value: USER, link: USER, source: 'theirs' }
const S = {
  title: (n) => `Chat with ${n}`, messageOn: () => 'Message on Signal',
  notConnected: (n) => `${n} is not connected yet`, empty: (n) => `Say hello to ${n}`, offline: 'Waiting for a connection',
  placeholder: 'Message', send: 'Send', longHint: 'Signal', sendAgain: 'Send again', pending: 'Waiting', sent: 'Sent', charsLeft: (n) => `${n} left`, you: 'You',
  notDelivered: 'Not delivered yet', sendVia: (k) => `Send via ${k}`,
}
const T0 = 1_800_000_000_000
/** Handlers started by a click are fire-and-forget in the view: let their promises finish. */
const settle = () => new Promise((r) => setTimeout(r, 0))

function harness({ connected = true, reachable = reach, online = true, failSend = false, book = emptyBook() } = {}) {
  const calls = []
  const copied = []
  const opened = []
  const state = { book, fail: failSend, saves: 0 }
  const io = {
    getBook: () => state.book,
    setBook: (b) => { if (b !== state.book) state.saves++; state.book = b },
    send: async (id, text, sentAt) => { calls.push({ id, text, sentAt }); if (state.fail) throw new Error('relay down') },
    now: () => T0 + calls.length * 10,
  }
  const doc = makeDoc()
  const handle = renderChat({ ...io, doc, person: { name: 'Lena', peerId: connected ? 'p1' : undefined, reach: reachable }, S, isOnline: () => online, copy: (t) => copied.push(t), open: (u) => opened.push(u) })
  return { copied, opened, handle, state, calls, io, doc, root: handle.el }
}

describe('safeHref', () => {
  it('allows https and mailto only', () => {
    expect(safeHref('https://signal.me/#eu/abc')).toBe('https://signal.me/#eu/abc')
    expect(safeHref('mailto:a@b.org')).toBe('mailto:a@b.org')
    for (const bad of ['javascript:alert(1)', 'http://x.org', 'data:text/html,x', 'sgnl://signal.me/#eu/x', '']) expect(safeHref(bad)).toBeNull()
  })
})

describe('chatViewModel', () => {
  it('not connected: no thread, only the outside link', () => {
    const vm = chatViewModel({ name: 'Lena', reach }, emptyBook(), true)
    expect(vm.status).toBe(ThreadStatus.NotConnected)
    expect(vm.externalLink.href).toBe(USER)
    expect(vm.rows).toEqual([])
  })
  it('connected without messages: empty; with messages: rows in order', () => {
    expect(chatViewModel({ name: 'L', peerId: 'p1', reach: null }, emptyBook(), true).status).toBe(ThreadStatus.Empty)
    let book = receiveText(emptyBook(), 'p1', 'hi', T0, T0).book
    book = queueOutgoing(book, 'p1', 'yo', T0 + 1).book
    const vm = chatViewModel({ name: 'L', peerId: 'p1', reach: null }, book, true)
    expect(vm.rows.map((r) => r.text)).toEqual(['hi', 'yo'])
    expect(vm.externalLink).toBeNull()
    expect(vm.hasPending).toBe(true)
  })
  it('the offline note shows only while something is waiting and the relay is down', () => {
    const book = queueOutgoing(emptyBook(), 'p1', 'yo', T0).book
    const p = { name: 'L', peerId: 'p1', reach: null }
    expect(chatViewModel(p, book, false).showOffline).toBe(true)
    expect(chatViewModel(p, book, true).showOffline).toBe(false)
    expect(chatViewModel(p, emptyBook(), false).showOffline).toBe(false)
  })
  it('an unsafe link is dropped, the rest still shows', () => {
    const vm = chatViewModel({ name: 'L', peerId: 'p1', reach: { ...reach, link: 'javascript:alert(1)' } }, emptyBook(), true)
    expect(vm.externalLink).toBeNull()
  })
  it('a peer id that is a prototype name does not read the prototype', () => {
    expect(chatViewModel({ name: 'L', peerId: 'constructor', reach: null }, emptyBook(), true).rows).toEqual([])
  })
})

describe('renderChat', () => {
  it('connected and empty: title, the outside link above, the empty note and a composer', () => {
    const { root } = harness()
    const kids = root.children.map((c) => c.tagName)
    expect(kids[0]).toBe('h3')
    expect(root.byTag('h3')[0].textContent).toBe('Chat with Lena')
    const a = root.byTag('a')[0]
    expect(a.attrs.href).toBe(USER)
    expect(a.attrs.rel).toBe('noopener noreferrer')
    expect(a.textContent).toBe('Message on Signal')
    expect(root.children.indexOf(a)).toBeLessThan(root.children.findIndex((c) => (c.attrs?.class ?? '') === 'chat-composer'))
    expect(root.find((n) => n.attrs['data-chat'] === 'empty')).toHaveLength(1)
    expect(root.byTag('textarea')).toHaveLength(1)
  })
  it('not connected: the note and the outside link, no composer', () => {
    const { root } = harness({ connected: false })
    expect(root.find((n) => n.attrs['data-chat'] === 'not-connected')).toHaveLength(1)
    expect(root.byTag('a')).toHaveLength(1)
    expect(root.byTag('textarea')).toHaveLength(0)
  })
  it('no known channel: no link at all', () => {
    expect(harness({ reachable: null }).root.byTag('a')).toHaveLength(0)
  })
  it('message text is set as text, never as markup', () => {
    const book = receiveText(emptyBook(), 'p1', '<img src=x onerror=alert(1)><b>x</b>', T0, T0).book
    const { root } = harness({ book })
    expect(root.byTag('img')).toHaveLength(0)
    expect(root.byTag('b')).toHaveLength(0)
    expect(root.byClass('chat-text')[0].textContent).toBe('<img src=x onerror=alert(1)><b>x</b>')
  })
  it('opening the thread marks it read', () => {
    const book = receiveText(emptyBook(), 'p1', 'hey', T0, T0).book
    expect(harness({ book }).state.book.p1.unread).toBe(0)
  })
  it('opening without anything unread does not trigger a save', () => {
    const h = harness({ book: queueOutgoing(emptyBook(), 'p1', 'yo', T0).book })
    expect(h.state.saves).toBe(0)
  })
  it('refresh shows a message that arrived while the screen is open', () => {
    const h = harness()
    h.state.book = receiveText(h.state.book, 'p1', 'late hello', T0, T0).book
    h.handle.refresh()
    expect(h.root.byClass('chat-text').map((n) => n.textContent)).toEqual(['late hello'])
  })
  it('refresh keeps what is being typed', () => {
    const h = harness()
    const area = h.root.byTag('textarea')[0]
    area.value = 'half a thou'
    area.fire('input')
    h.handle.refresh()
    expect(h.root.byTag('textarea')[0].value).toBe('half a thou')
  })
})

describe('sending from the view', () => {
  it('send: queues, sends once with the stored timestamp, ends delivered, clears the box', async () => {
    const h = harness()
    const area = h.root.byTag('textarea')[0]
    area.value = '  Hello there '
    area.fire('input')
    await h.root.byTag('button').find((b) => b.textContent === 'Send').fire('click')
    await settle()
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0]).toMatchObject({ id: 'p1', text: 'Hello there' })
    expect(h.state.book.p1.messages[0].state).toBe(MessageState.Delivered)
    expect(h.state.book.p1.messages[0].sentAt).toBe(h.calls[0].sentAt)
    expect(h.root.byTag('textarea')[0].value).toBe('')
    expect(h.root.byClass('chat-text')[0].textContent).toBe('Hello there')
  })
  it('an empty box sends nothing', async () => {
    const h = harness()
    await h.root.byTag('button').find((b) => b.textContent === 'Send').fire('click')
    await settle()
    expect(h.calls).toHaveLength(0)
    expect(h.state.book).toEqual({})
  })
  it('a failed send stays pending, shows the offline note and keeps the text in the thread', async () => {
    const h = harness({ failSend: true, online: false })
    const area = h.root.byTag('textarea')[0]
    area.value = 'will queue'
    area.fire('input')
    await h.root.byTag('button').find((b) => b.textContent === 'Send').fire('click')
    await settle()
    expect(h.state.book.p1.messages[0].state).toBe(MessageState.Pending)
    expect(h.root.find((n) => n.attrs['data-chat'] === 'offline')).toHaveLength(1)
    expect(h.root.byClass('chat-meta')[0].textContent).toContain('Waiting')
  })
  it('send again retries with the SAME timestamp and then delivers', async () => {
    const h = harness({ failSend: true })
    const area = h.root.byTag('textarea')[0]
    area.value = 'retry me'
    area.fire('input')
    await h.root.byTag('button').find((b) => b.textContent === 'Send').fire('click')
    await settle()
    h.state.fail = false
    await h.root.byTag('button').find((b) => b.textContent === 'Send again').fire('click')
    await settle()
    expect(h.calls).toHaveLength(2)
    expect(h.calls[1].sentAt).toBe(h.calls[0].sentAt)
    expect(h.state.book.p1.messages[0].state).toBe(MessageState.Delivered)
  })
  it('Ctrl+Enter sends, plain Enter does not', async () => {
    const h = harness()
    const area = h.root.byTag('textarea')[0]
    area.value = 'quick'
    area.fire('input')
    let prevented = false
    await area.fire('keydown', { key: 'Enter', preventDefault: () => { prevented = true } })
    expect(h.calls).toHaveLength(0)
    await area.fire('keydown', { key: 'Enter', ctrlKey: true, preventDefault: () => { prevented = true } })
    await settle()
    expect(prevented).toBe(true)
    expect(h.calls).toHaveLength(1)
  })
})

describe('flushPending / submitText', () => {
  const ioFor = (failAt) => {
    const sent = []
    const state = { book: emptyBook() }
    return {
      sent, state,
      io: {
        getBook: () => state.book, setBook: (b) => { state.book = b }, now: () => T0,
        send: async (_id, text) => { if (text === failAt) throw new Error('down'); sent.push(text) },
      },
    }
  }
  it('sends oldest first and stops at the first failure, keeping the rest pending', async () => {
    const { io, sent, state } = ioFor('two')
    state.book = queueOutgoing(queueOutgoing(queueOutgoing(emptyBook(), 'p1', 'one', T0).book, 'p1', 'two', T0 + 1).book, 'p1', 'three', T0 + 2).book
    expect(await flushPending(io, 'p1')).toBe(1)
    expect(sent).toEqual(['one'])
    expect(state.book.p1.messages.map((m) => m.state)).toEqual([MessageState.Delivered, MessageState.Pending, MessageState.Pending])
  })
  it('flushing twice never sends a delivered message again', async () => {
    const { io, sent } = ioFor(null)
    await submitText(io, 'p1', 'once')
    await flushPending(io, 'p1')
    expect(sent).toEqual(['once'])
  })
  it('submitText refuses empty text without touching the book', async () => {
    const { io, state } = ioFor(null)
    expect(await submitText(io, 'p1', '   ')).toBe(false)
    expect(state.book).toEqual({})
  })
})

describe('injectChatStyles', () => {
  it('adds the style element once', () => {
    const doc = makeDoc()
    injectChatStyles(doc)
    injectChatStyles(doc)
    expect(doc.head.byTag('style')).toHaveLength(1)
  })
})

describe('renderShareControls', () => {
  const SS = {
    tickLabel: 'Share this link when we connect', tickPhoneNote: 'This link holds your phone number', tickHint: 'Sent links stay with the people who got them',
  }
  const make = (handle, settings) => {
    const box = { handle, settings }
    const root = renderShareControls({
      doc: makeDoc(), channel: Channel.Signal, getHandle: () => box.handle, getSettings: () => box.settings,
      setSettings: (s) => { box.settings = s }, S: SS,
    })
    return { box, root }
  }
  it('nothing saved yet: no controls', () => {
    expect(make(undefined, undefined).root.children).toHaveLength(0)
  })
  it('starts unticked, and offers no Signal/Molly choice any more (wave 6e)', () => {
    const { root } = make(USER, undefined)
    expect(root.byTag('input')[0].checked).toBe(false)
    expect(root.byTag('button')).toHaveLength(0)
    expect(root.find((n) => n.attrs['data-provider'] !== undefined)).toHaveLength(0)
  })
  it('ticking records the tick and unticking records false', () => {
    const { box, root } = make(USER, undefined)
    const input = root.byTag('input')[0]
    input.checked = true
    input.fire('change')
    expect(box.settings.shareOnConnect.signal).toBe(true)
    input.checked = false
    input.fire('change')
    expect(box.settings.shareOnConnect.signal).toBe(false)
  })
  it('a phone number shows the warning, a username link does not', () => {
    expect(make('+436601234567', undefined).root.find((n) => n.attrs['data-share'] === 'phone')).toHaveLength(1)
    expect(make(USER, undefined).root.find((n) => n.attrs['data-share'] === 'phone')).toHaveLength(0)
  })
  it('a stored provider stays in the settings when the tick changes (read, never changed)', () => {
    const { box, root } = make(USER, { shareOnConnect: { signal: true }, signalProvider: 'molly' })
    const input = root.byTag('input')[0]
    input.checked = false
    input.fire('change')
    expect(box.settings).toEqual({ shareOnConnect: { signal: false }, signalProvider: 'molly' })
  })
  it('WhatsApp: a number shows the warning, a wa.me/qr link does not; Matrix has the tick only', () => {
    const wa = (handle) => renderShareControls({ doc: makeDoc(), channel: Channel.WhatsApp, getHandle: () => handle, getSettings: () => undefined, setSettings: () => {}, S: SS })
    expect(wa('+430000000000').find((n) => n.attrs['data-share'] === 'phone')).toHaveLength(1)
    expect(wa('https://wa.me/qr/ABCDEFGH12345').find((n) => n.attrs['data-share'] === 'phone')).toHaveLength(0)
    const mx = renderShareControls({ doc: makeDoc(), channel: Channel.Matrix, getHandle: () => '@lena:matrix.org', getSettings: () => undefined, setSettings: () => {}, S: SS })
    expect(mx.byTag('input')[0].attrs['data-share-tick']).toBe('matrix')
  })
})

describe('undelivered fallback', () => {
  const theirs = { signal: '+436601234567', whatsapp: '+436601234567' }
  const stuck = () => {
    const book = queueOutgoing(emptyBook(), 'p1', 'hello', T0 - 25 * 3600_000).book
    const h = harness({ book })
    h.handle.refresh() // io.now() is T0
    return h
  }
  it('stuck pending message shows the line and buttons; press copies and opens, delivery unchanged', async () => {
    const book = queueOutgoing(emptyBook(), 'p1', 'hello', T0 - 25 * 3600_000).book
    const state = { book }
    const doc = makeDoc(); const copied = []; const opened = []
    const handle = renderChat({
      getBook: () => state.book, setBook: (b) => { state.book = b }, send: async () => {}, now: () => T0, doc, S, isOnline: () => true,
      person: { name: 'Lena', peerId: 'p1', reach, theirChannels: theirs }, copy: (t) => copied.push(t), open: (u) => opened.push(u),
    })
    const btns = handle.el.find((n) => n.attrs['data-chat-fallback'])
    expect(btns.map((b) => b.attrs['data-chat-fallback'])).toEqual(['signal', 'whatsapp'])
    expect(handle.el.find((n) => n.attrs['data-chat-stuck'])[0].textContent).toContain('Not delivered yet')
    await btns[1].fire('click')
    expect(copied).toEqual(['hello'])
    expect(opened).toEqual(['https://wa.me/436601234567?text=hello'])
    expect(state.book.p1.messages[0].state).toBe(MessageState.Pending)
  })
  it('fresh message or no channel: nothing', () => {
    const fresh = harness({ book: queueOutgoing(emptyBook(), 'p1', 'hi', T0).book })
    expect(fresh.root.find((n) => n.attrs['data-chat-stuck'])).toEqual([])
    expect(stuck().root.find((n) => n.attrs['data-chat-stuck'])).toEqual([])
  })
})
