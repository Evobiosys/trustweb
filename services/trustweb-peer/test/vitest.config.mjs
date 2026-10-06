// Standalone vitest config for the peer service tests (no imports: the service
// has no node_modules of its own; tsx-style .ts imports resolve through vitest).
// Run from the repo root:
//   apps/demo/node_modules/.bin/vitest run --config services/trustweb-peer/test/vitest.config.mjs --root services/trustweb-peer
export default {
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.mjs'],
  },
}
