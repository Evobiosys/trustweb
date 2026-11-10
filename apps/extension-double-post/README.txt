SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later

Also post to TrustWeb (browser extension, Manifest V3, Chrome / Brave / Edge)

WHAT IT DOES
After you press the publish button on Mastodon, X, Facebook or LinkedIn, a small box asks:
"Also post to TrustWeb?"  [Yes] [Not now] [Never on this site]
Yes opens  <TrustWeb address>/#compose=<your text>&from=<site>  in a new tab.
Your post on the network is never blocked or changed.

PRIVACY (site texts, formulated by an AI agent, to be checked by Jakob)
- The extension reads exactly one thing: the text in the compose box, at the moment you click the network's own publish button.
- It reads no feeds, posts of others, messages, names, cookies or logins.
- It makes no network request of its own: no analytics, no remote code, no fonts. A test checks the built files.
- Your text leaves the page only when you press Yes, inside the address of the new TrustWeb tab (after the #).
  Browsers never send that part to a server; TrustWeb removes it from the address bar at once.
- It stores only its settings (which sites, TrustWeb address, muted sites) in the browser.

PERMISSIONS
- storage: the settings.
- scripting + optional host permission: only so that you can add a Mastodon instance (the browser asks once per instance).
- sites: the content script runs on https://x.com, https://twitter.com, https://www.facebook.com, https://www.linkedin.com only (content_scripts matches; no extra host permission).

SETTINGS (extension options page)
- On/off per network, TrustWeb address (default https://app.trustweb.one; http://127.0.0.1:<port> allowed for a local preview),
  Mastodon instances (add / remove), muted sites.

DETECTION
Selectors per network sit in one table, src/selectors.ts (best effort; a site redesign is a one-line fix there). A selector that
no longer matches makes the extension do nothing, never break the page.
Mastodon: textarea.autosuggest-textarea__textarea, .compose-form textarea; button.compose-form__submit-button.
X: [data-testid="tweetTextarea_0"], [data-testid="tweetButton"|"tweetButtonInline"].
Facebook: [role=dialog] [contenteditable][role=textbox], [role=dialog] [aria-label=Post].
LinkedIn: .share-box [role=textbox], button.share-actions__primary-action.

BUILD, TEST, PACK  (from apps/extension-double-post; node 22; uses the repo's vite from apps/demo)
  node build.mjs --out dist --zip           -> dist/ (load unpacked) and also-post-to-trustweb.zip next to it
  cd ../demo && node_modules/.bin/vitest run --config ../extension-double-post/vitest.config.mjs --root ../extension-double-post
  ../demo/node_modules/.bin/tsc --noEmit -p tsconfig.json
  PW=<repo>/apps/crm/node_modules/playwright-core/index.js EXE=<chromium binary> node test/e2e/double_post.mjs

TRUSTWEB SIDE
The #compose= hand-over is read by TrustWeb in a later row (strict parse, clear the hash, prefill the composer, nothing posted until the user taps Post).
