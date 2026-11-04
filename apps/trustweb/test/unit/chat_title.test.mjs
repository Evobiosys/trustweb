// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 30 chat-title: the Chat screen's page title names the current messenger view (messenger_combine.ts chatTitle). Pure. */
import { chatTitle } from '../../src/messenger_combine.ts'

const src = (id, label, status = 'ready') => ({ id, label, status: () => status })
const sources = [src('signal-link', 'Signal'), src('matrix', 'Matrix'), src('geb', 'WhatsApp', 'needs-setup')]

describe('chat title', () => {
  it('names a single messenger', () => {
    expect(chatTitle(sources, new Set(), ['trustweb'], 'All chats', 'TrustWeb')).toBe('TrustWeb')
    expect(chatTitle(sources, new Set(), ['signal-link'], 'All chats', 'TrustWeb')).toBe('Signal')
  })
  it('joins a combined pair as TrustWeb + Signal', () => {
    expect(chatTitle(sources, new Set(), ['trustweb', 'signal-link'], 'All chats', 'TrustWeb')).toBe('TrustWeb + Signal')
  })
  it('uses the all-chats name when every usable source is in', () => {
    expect(chatTitle(sources, new Set(), ['trustweb', 'signal-link', 'matrix'], 'All chats', 'TrustWeb')).toBe('All chats')
  })
  it('falls back to TrustWeb when the chosen source needs setup or is switched off', () => {
    expect(chatTitle(sources, new Set(), ['geb'], 'All chats', 'TrustWeb')).toBe('TrustWeb')
    expect(chatTitle(sources, new Set(['matrix']), ['matrix'], 'All chats', 'TrustWeb')).toBe('TrustWeb')
  })
})
