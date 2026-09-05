// Unit tests for DeclarationStore: append, rebuild, tombstone. Zero dependency on
// @resource-web/wot-policy, so these pass independent of that package's build state.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeclarationStore } from '../src/store.js';
import type { PublishedDeclaration } from '../src/types.js';

function makeDeclaration(overrides: Partial<PublishedDeclaration> = {}): PublishedDeclaration {
  return {
    id: overrides.id ?? `decl-${Math.random().toString(36).slice(2)}`,
    facets: {
      category: 'accommodation.sublet',
      regionCode: 'AT-9',
      authorCommitment: 'author-a',
      sensitive: false,
      ...overrides.facets,
    },
    sealedBody: 'sealed-opaque-base64url',
    publishedAt: new Date().toISOString(),
    instanceId: 'wot-central-at',
    residency: 'AT',
    ...overrides,
  };
}

describe('DeclarationStore', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'wot-central-index-test-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('publishes a declaration and it is immediately retrievable', () => {
    const store = new DeclarationStore(dataDir);
    const decl = makeDeclaration();
    store.publish(decl);

    expect(store.get(decl.id)).toEqual(decl);
    expect(store.size).toBe(1);
  });

  it('matches on category and regionCode', () => {
    const store = new DeclarationStore(dataDir);
    const decl = makeDeclaration();
    store.publish(decl);

    expect(store.matching('accommodation.sublet', 'AT-9')).toHaveLength(1);
    expect(store.matching('accommodation.sublet', 'AT-4')).toHaveLength(0);
    expect(store.matching('other.category', 'AT-9')).toHaveLength(0);
  });

  it('a fresh store instance rebuilds its index from the JSONL log on disk', () => {
    const store = new DeclarationStore(dataDir);
    const a = makeDeclaration({ id: 'a' });
    const b = makeDeclaration({ id: 'b', facets: { category: 'x', regionCode: 'y', authorCommitment: 'z', sensitive: true } });
    store.publish(a);
    store.publish(b);

    const rebuilt = new DeclarationStore(dataDir);
    expect(rebuilt.size).toBe(2);
    expect(rebuilt.get('a')).toEqual(a);
    expect(rebuilt.get('b')).toEqual(b);
  });

  it('withdraw appends a tombstone and drops the record from the in-memory index immediately', () => {
    const store = new DeclarationStore(dataDir);
    const decl = makeDeclaration({ id: 'w1' });
    store.publish(decl);
    expect(store.get('w1')).toBeDefined();

    const existed = store.withdraw('w1');
    expect(existed).toBe(true);
    expect(store.get('w1')).toBeUndefined();
    expect(store.matching(decl.facets.category, decl.facets.regionCode)).toHaveLength(0);
  });

  it('withdrawing an unknown id is idempotent and reports it was not present', () => {
    const store = new DeclarationStore(dataDir);
    expect(store.withdraw('never-existed')).toBe(false);
    expect(store.size).toBe(0);
  });

  it('a rebuild honours tombstones: a withdrawn record does not reappear', () => {
    const store = new DeclarationStore(dataDir);
    const decl = makeDeclaration({ id: 'gone' });
    store.publish(decl);
    store.withdraw('gone');

    const rebuilt = new DeclarationStore(dataDir);
    expect(rebuilt.get('gone')).toBeUndefined();
    expect(rebuilt.size).toBe(0);
  });

  it('a re-publish after withdrawal (new id) is honoured by rebuild, not swallowed by the tombstone', () => {
    const store = new DeclarationStore(dataDir);
    store.publish(makeDeclaration({ id: 'first' }));
    store.withdraw('first');
    store.publish(makeDeclaration({ id: 'second' }));

    const rebuilt = new DeclarationStore(dataDir);
    expect(rebuilt.get('first')).toBeUndefined();
    expect(rebuilt.get('second')).toBeDefined();
    expect(rebuilt.size).toBe(1);
  });

  it('clearAuthor withdraws every declaration for one author and leaves other authors untouched', () => {
    const store = new DeclarationStore(dataDir);
    store.publish(makeDeclaration({ id: 'a1', facets: { category: 'c', regionCode: 'r', authorCommitment: 'author-x', sensitive: false } }));
    store.publish(makeDeclaration({ id: 'a2', facets: { category: 'c2', regionCode: 'r2', authorCommitment: 'author-x', sensitive: false } }));
    store.publish(makeDeclaration({ id: 'b1', facets: { category: 'c', regionCode: 'r', authorCommitment: 'author-y', sensitive: false } }));

    const cleared = store.clearAuthor('author-x');

    expect(cleared).toBe(2);
    expect(store.listByAuthor('author-x')).toHaveLength(0);
    expect(store.listByAuthor('author-y')).toHaveLength(1);
    expect(store.size).toBe(1);

    const rebuilt = new DeclarationStore(dataDir);
    expect(rebuilt.listByAuthor('author-x')).toHaveLength(0);
    expect(rebuilt.listByAuthor('author-y')).toHaveLength(1);
  });

  it('allFacets exposes every currently-indexed facet set, for requiresSoleAuthorAck corpus checks', () => {
    const store = new DeclarationStore(dataDir);
    store.publish(makeDeclaration({ id: 'f1' }));
    store.publish(makeDeclaration({ id: 'f2', facets: { category: 'x', regionCode: 'y', authorCommitment: 'z', sensitive: true } }));

    expect(store.allFacets()).toHaveLength(2);
  });

  it('starting a store against a directory that does not exist yet creates it and starts empty', () => {
    const freshDir = join(dataDir, 'nested', 'does-not-exist-yet');
    const store = new DeclarationStore(freshDir);
    expect(store.size).toBe(0);
    store.publish(makeDeclaration({ id: 'ok' }));
    expect(store.get('ok')).toBeDefined();
  });
});
