// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// One data table per network: a site redesign is a one-line fix here. Best effort; the
// scripts fail silently when a selector no longer matches.

export type Network = 'mastodon' | 'x' | 'facebook' | 'linkedin'

export interface NetworkSelectors {
  /** Hosts the network lives on; empty = any host (Mastodon: instances are unbounded). */
  hosts: string[]
  /** Compose text fields (textarea or contenteditable), most specific first. */
  composer: string[]
  /** The network's own publish button. */
  submit: string[]
}

export const NETWORKS: Record<Network, NetworkSelectors> = {
  mastodon: {
    hosts: [],
    composer: ['textarea.autosuggest-textarea__textarea', '.compose-form textarea'],
    submit: ['button.compose-form__submit-button', '.compose-form__publish button', 'button.compose-form__publish-button'],
  },
  x: {
    hosts: ['x.com', 'twitter.com'],
    composer: ['[data-testid="tweetTextarea_0"]'],
    submit: ['[data-testid="tweetButton"]', '[data-testid="tweetButtonInline"]'],
  },
  facebook: {
    hosts: ['www.facebook.com'],
    composer: ['[role="dialog"] [contenteditable="true"][role="textbox"]'],
    submit: ['[role="dialog"] [aria-label="Post"][role="button"]', '[role="dialog"] div[aria-label="Post"]'],
  },
  linkedin: {
    hosts: ['www.linkedin.com'],
    composer: ['.share-box [role="textbox"]', '.share-creation-state [role="textbox"]'],
    submit: ['button.share-actions__primary-action'],
  },
}

/** Network for a host: a named host wins, anything else is treated as a possible Mastodon instance. */
export function networkForHost(host: string): Network {
  for (const [name, n] of Object.entries(NETWORKS) as [Network, NetworkSelectors][]) {
    if (n.hosts.includes(host)) return name
  }
  return 'mastodon'
}
