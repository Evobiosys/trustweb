// Standalone vitest config for the peer service tests (no imports: the service
// has no node_modules of its own; tsx-style .ts imports resolve through vitest).
// Run from the repo root:
//   apps/demo/node_modules/.bin/vitest run --config services/trustweb-peer/test/vitest.config.mjs --root services/trustweb-peer
// TW_VITEST_CACHE: a private cache dir (the node_modules are shared with the
// primary checkout, where other runs use the default cache at the same time).
export default {
  ...(process.env.TW_VITEST_CACHE ? { cacheDir: process.env.TW_VITEST_CACHE } : {}),
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.mjs'],
  },
}
