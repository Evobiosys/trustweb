// Config for the live TalkWeave probe only (see talkweave_probe.test.mjs).
export default {
  test: {
    globals: true,
    environment: 'node',
    include: ['test/e2e/talkweave_probe.test.mjs'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
}
