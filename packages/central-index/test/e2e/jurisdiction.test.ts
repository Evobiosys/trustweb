// U5 end-to-end assertion 6: GET /jurisdiction returns residency 'AT' for the default config,
// and the operator contact. Also spot-checks GET /health, since it shares the same
// jurisdiction-loading path (jurisdiction.instanceId) and is on the required endpoint table.
//
// jurisdiction: 'at' is passed explicitly to createCentralServer rather than relying on
// loadJurisdiction's own default so this test cannot be broken by a stray
// WOT_CENTRAL_JURISDICTION left set in the environment.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer, stopTestServer, get, type TestServer, TEST_TIMEOUT_MS } from './helpers.js';

describe('e2e: GET /jurisdiction and GET /health', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer('at');
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await stopTestServer(t);
  });

  it('GET /jurisdiction returns residency AT and the operator contact for the default config', async () => {
    const res = await get(t.baseUrl, '/jurisdiction');
    expect(res.status).toBe(200);
    const body = res.json as { residency: string; operatorContact: string; instanceId: string };
    expect(body.residency).toBe('AT');
    expect(typeof body.operatorContact).toBe('string');
    expect(body.operatorContact.length).toBeGreaterThan(0);
    expect(body.operatorContact).toBe('connect@japossert.com');
  });

  it('GET /health reports ok and the same instanceId as /jurisdiction', async () => {
    const jurisdiction = await get(t.baseUrl, '/jurisdiction');
    const health = await get(t.baseUrl, '/health');
    expect(health.status).toBe(200);
    const healthBody = health.json as { ok: boolean; instanceId: string };
    const jurisdictionBody = jurisdiction.json as { instanceId: string };
    expect(healthBody.ok).toBe(true);
    expect(healthBody.instanceId).toBe(jurisdictionBody.instanceId);
  });
});
