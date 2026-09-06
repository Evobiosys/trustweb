// U5 end-to-end assertion 8: a query response never contains raw vault text, an author name,
// or a street address.
//
// `sealedBody` is opaque ciphertext (types.ts: "the server never decodes or reads this") and is
// returned verbatim on a hit, by design (server.ts's DeclarationHit mapping). So a canary
// planted INSIDE sealedBody would legitimately come back in the response -- that would not be a
// leak, it would be sealedBody working as specified, and asserting its absence would be
// asserting a false thing about a compliant server. To honestly test the "never leaves the
// device" list (handover section 1), the canaries below are planted instead in exactly the
// fields the server is supposed to drop or never receive in the first place:
//   - a fake author name and a street address as EXTRA, unexpected top-level keys on the
//     publish request (fields no schema names, so if anything echoed the raw request body back
//     these would appear)
//   - vault-text and an author-name canary in askerLabel/askerDid on the query, which
//     protectAsker must strip before anything touches the payload when facets.sensitive is true
//   - authorCommitment itself, which DeclarationHit's type deliberately omits (the real leak
//     the shape was designed to prevent, per types.ts's own comment) -- checked directly against
//     the parsed hit object, and the raw commitment string is also checked against the response
//     text as one more independent line of defence.
// sealedBody is kept as an opaque base64url-shaped string with no recognisable plaintext in it,
// so it cannot itself trip any of these assertions.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer, stopTestServer, post, makeFacets, makeSigner, type TestServer, TEST_TIMEOUT_MS, LONG_TEST_TIMEOUT_MS } from './helpers.js';

const VAULT_TEXT_CANARY = 'the-vault-said-my-safe-word-is-heliotrope-42';
const AUTHOR_NAME_CANARY = 'Maximilian Ferdinand Habsburg-Canary';
const STREET_ADDRESS_CANARY = 'Mariahilfer Strasse 88, Top 4, 1060 Wien';
const AUTHOR_COMMITMENT = 'author-e2e-no-leakage-commitment-hash';

describe('e2e: a query response never contains raw vault text, an author name, or a street address', () => {
  let t: TestServer;
  const facetOverrides = { category: 'accommodation.sublet-e2e-leakage', regionCode: 'AT-leak', sensitive: true };

  beforeAll(async () => {
    t = await startTestServer('at');

    // Seed 7 distinct authors so the query below is above floor and actually returns hits --
    // an empty/below-floor response trivially "contains" none of the canaries, which would
    // prove nothing. authorNameCanary/streetAddressCanary are sent as extra top-level publish
    // request fields the server's validatePublishRequest does not name in its shape, i.e.
    // fields nothing should read, store or echo.
    for (let i = 0; i < 6; i++) {
      const filler = await makeSigner();
      const res = await post(t.baseUrl, '/declarations', {
        facets: makeFacets({ ...facetOverrides, authorCommitment: `filler-author-${i}` }),
        sealedBody: `sealed-opaque-filler-${i}`,
        holderPubKey: filler.publicKeyB64u,
        soleAuthorAck: true,
      });
      expect(res.status, JSON.stringify(res.json)).toBe(201);
    }
    const targetSigner = await makeSigner();
    const target = await post(t.baseUrl, '/declarations', {
      facets: makeFacets({ ...facetOverrides, authorCommitment: AUTHOR_COMMITMENT }),
      sealedBody: 'sealed-opaque-target-abc123',
      holderPubKey: targetSigner.publicKeyB64u,
      soleAuthorAck: true,
      authorName: AUTHOR_NAME_CANARY,
      streetAddress: STREET_ADDRESS_CANARY,
      vaultText: VAULT_TEXT_CANARY,
    });
    expect(target.status, JSON.stringify(target.json)).toBe(201);
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await stopTestServer(t);
  });

  it(
    'the raw query response text contains none of the canaries, and no hit carries authorCommitment',
    async () => {
      const res = await post(t.baseUrl, '/query', {
        facets: makeFacets(facetOverrides),
        askerDid: `did:example:${VAULT_TEXT_CANARY}`,
        askerLabel: AUTHOR_NAME_CANARY,
      });
      expect(res.status).toBe(200);

      expect(res.text).not.toContain(VAULT_TEXT_CANARY);
      expect(res.text).not.toContain(AUTHOR_NAME_CANARY);
      expect(res.text).not.toContain(STREET_ADDRESS_CANARY);
      expect(res.text).not.toContain(AUTHOR_COMMITMENT);

      const hits = (res.json as { hits: Array<Record<string, unknown>> }).hits;
      expect(hits.length).toBeGreaterThan(0);
      for (const hit of hits) {
        expect(Object.keys(hit)).not.toContain('authorCommitment');
        expect(Object.keys(hit)).not.toContain('authorName');
        expect(Object.keys(hit)).not.toContain('streetAddress');
        expect(Object.keys(hit)).not.toContain('askerDid');
        expect(Object.keys(hit)).not.toContain('askerLabel');
      }
    },
    LONG_TEST_TIMEOUT_MS,
  );
});
