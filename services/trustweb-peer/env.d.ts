// apps/demo's relay.ts reads `import.meta.env?.VITE_RELAY_ORIGIN` (a Vite-only
// construct, undefined under Node); this declaration lets the service typecheck
// without Vite's client types.
interface ImportMetaEnv { readonly VITE_RELAY_ORIGIN?: string }
interface ImportMeta { readonly env?: ImportMetaEnv }
