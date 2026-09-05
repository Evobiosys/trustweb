/**
 * Public surface of the opt-in central-RAG client adapter.
 *
 * Nothing here self-mounts (handover, unit U4 note): these are libraries
 * with tests, not wired into `main.ts`. Wiring a panel into the demo UI is a
 * follow-up one-line import, named in the handover as the fallback if the
 * jurisdiction status page ends up being where this lives instead.
 */
export * from './types'
export * from './mode'
export * from './coarsen'
export * from './consent'
export * from './client'
