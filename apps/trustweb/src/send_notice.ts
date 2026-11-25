// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave47 invite-fits-chat (Jakob 2026-11-25: "why does it say that?"): a send that was refused says why. "No connection right now. Your message waits
 * here..." (S.chatOffline) used to stand for every refusal, also when nothing waited and the connection was fine (an invite text over the chat bound, a
 * person never connected, a blocked person). It now belongs to the transport alone (chat thread, outbox notice); every other refusal has its own sentence.
 */
import { queueRefusal, type QueueRefusal } from './chat'
import { submitText, type ChatIo } from './chat_view'

export type SendRefusal = QueueRefusal | 'blocked' | 'failed'

/** What a rejected send (net.ts sendText, main.ts sendProtocol / chatIo) was refused for. */
export function refusalOfError(e: unknown): SendRefusal {
  const why = e instanceof Error ? e.message : ''
  return why === 'blocked' ? 'blocked' : why === 'no peer' || why === 'not connected' ? 'not-connected' : 'failed'
}

/** Puts `text` into my chat with that person and sends it; null = it is in the thread (sent, or waiting there for the connection), else why nothing was queued. */
export async function sendToChat(io: ChatIo, peerId: string | undefined, text: string): Promise<SendRefusal | null> {
  const why = queueRefusal(io.getBook(), peerId, text)
  if (why || !peerId) return why ?? 'not-connected'
  return (await submitText(io, peerId, text)) ? null : 'failed'
}
