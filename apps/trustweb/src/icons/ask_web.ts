// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 25 (Jakob 2026-10-29): the "Ask your web" icon (two people, a "?" badge top right: asking the web, not clarifying;
 * 'rings' adds three wifi-style arcs to the right = the call into the web) and the Record icon (a person with a microphone in front).
 * Stroke-only, 24 px grid, drawn in the text colour like src/icons.ts.
 */
export type AskIconVariant = 'rings' | 'plain'

const PEOPLE = '<circle cx="6" cy="9" r="2.8"/><path d="M1.5 20a4.5 4.5 0 0 1 9 0"/><path d="M9.6 6.4a2.8 2.8 0 0 1 0 5.2"/>'
const QUESTION = '<g data-ask-q="1"><path d="M15.6 4.2a2.4 2.4 0 1 1 3.4 2.2c-.7.4-1 .8-1 1.6"/><path d="M18 10h.01"/></g>'
const ARCS = ['M16.5 14.6a2 2 0 0 1 0 3.2', 'M18.6 12.8a4.4 4.4 0 0 1 0 6.8', 'M20.7 11a6.8 6.8 0 0 1 0 10.4']
  .map((d) => `<path data-ask-arc="1" d="${d}"/>`).join('')

export function askWebIcon(variant: AskIconVariant | string): string {
  return `<svg viewBox="0 0 24 24">${PEOPLE}${QUESTION}${variant === 'plain' ? '' : ARCS}</svg>`
}

export function recordIcon(): string {
  return '<svg viewBox="0 0 24 24"><g data-rec-person="1"><circle cx="8.5" cy="7" r="3.3"/><path d="M2.5 21a6 6 0 0 1 12 0"/></g>'
    + '<g data-rec-mic="1"><rect x="16" y="9" width="4" height="6.5" rx="2"/><path d="M14.5 13.5a3.5 3.5 0 0 0 7 0"/><path d="M18 17v3"/></g></svg>'
}
