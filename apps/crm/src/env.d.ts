/// <reference types="svelte" />
/// <reference types="vite/client" />

// TrustWeb's model.ts imports types from apps/demo (did.ts), which pulls in two
// crypto packages this app never calls and does not install. Shorthand
// declarations keep the type-check from following them into node_modules.
declare module '@noble/curves/ed25519.js'
declare module 'multiformats/bases/base58'

/** Dev server only (vite.config.ts): the text of the file TW_CRM_RECORD names, else null. */
declare const __TW_RECORD__: string | null
/** Dev server only: TW_CRM_TANA_TOKEN, to preload Tana sync on the developer's own device. Never set in a build. */
declare const __TW_TANA_TOKEN__: string | null
