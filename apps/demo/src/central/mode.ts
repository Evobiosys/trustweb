/**
 * Build-time central-layer opt-in switch.
 *
 * Mirrors `../mode.ts`'s fall-through shape exactly: any value other than
 * the exact string `'on'` -- unset, a typo, an old value -- falls through to
 * `'off'`, never the other way round.
 *
 * That direction is not arbitrary here. `import.meta.env.VITE_WOT_CENTRAL`
 * is a plain Vite-injected build-time constant: any `VITE_`-prefixed name
 * Vite sees at build time gets baked into the bundle for EVERY consumer of
 * `import.meta.env` compiled in that same process (build-session trap 1,
 * see `../mode.ts`'s own header for the general mechanism). Concretely: if a
 * shell used to build demo N for something unrelated still has
 * `export VITE_WOT_CENTRAL=on` left over from an earlier experiment, that
 * export bakes into demo N's build too, silently, with nobody having asked
 * for the central layer in that build at all. Requiring the exact string
 * `'on'` cannot stop a genuinely-set stale export from doing this -- no
 * fall-through direction can -- but it does mean every OTHER accident
 * (unset, a typo like `'On'`/`'true'`/`'1'`, a value left over from a
 * differently-named flag) fails toward `'off'`, the side that adds no
 * exposure, rather than toward silently turning on a network-touching,
 * opt-in-data-publishing layer that Handover 2 requires to default off. An
 * exported `VITE_WOT_CENTRAL` must therefore be treated as a per-invocation
 * flag (`VITE_WOT_CENTRAL=on npx vite build`, not `export VITE_WOT_CENTRAL=on`
 * left standing in a shell) -- the same discipline the demo already expects
 * of `VITE_WOT_MODE` and `VITE_RELAY_ORIGIN`.
 */
export type CentralMode = 'on' | 'off'

export function centralMode(): CentralMode {
  const v = import.meta.env?.VITE_WOT_CENTRAL
  if (v === 'on') return 'on'
  return 'off'
}
