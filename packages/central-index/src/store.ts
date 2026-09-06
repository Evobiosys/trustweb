// Append-only JSONL store for published declarations, plus an in-memory
// facet index rebuilt from the log on start. Zero imports from
// @resource-web/wot-policy — the floor and asker-protection decisions live
// in server.ts, which calls this store for candidates and to persist/erase
// records. Keeping this file policy-free means its own tests are
// independent of whether U1's package has landed yet.
//
// Withdrawal is a tombstone record, not a line deletion: JSONL is
// append-only by design (matches the engine style already in this repo),
// and a tombstone-aware rebuild is what "a rebuild must honour tombstones"
// requires. One tombstone per declaration id, including for /clear, so a
// later re-publish by the same holder is never retroactively swallowed by
// a coarser "clear this author" record.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeclarationFacets, PublishedDeclaration, StoreRecord } from './types.js';

export class DeclarationStore {
  private readonly filePath: string;
  private readonly index = new Map<string, PublishedDeclaration>();

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.filePath = join(dataDir, 'declarations.jsonl');
    this.rebuild();
  }

  /** Re-reads the log from scratch and replaces the in-memory index. Publishes and tombstones
   *  are applied strictly in file order, so a tombstone after a publish removes it, and a
   *  publish after a tombstone (a re-publish under a new id) is honoured. */
  rebuild(): void {
    this.index.clear();
    if (!existsSync(this.filePath)) return;
    const raw = readFileSync(this.filePath, 'utf-8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const record = JSON.parse(trimmed) as StoreRecord;
      if (record.type === 'publish') {
        this.index.set(record.declaration.id, record.declaration);
      } else {
        this.index.delete(record.id);
      }
    }
  }

  private append(record: StoreRecord): void {
    appendFileSync(this.filePath, JSON.stringify(record) + '\n', 'utf-8');
  }

  publish(declaration: PublishedDeclaration): void {
    this.append({ type: 'publish', declaration });
    this.index.set(declaration.id, declaration);
  }

  /** Idempotent: withdrawing an unknown or already-withdrawn id still appends a tombstone
   *  (cheap, avoids a read-then-write race) and returns whether it was present. */
  withdraw(id: string): boolean {
    const existed = this.index.has(id);
    this.append({ type: 'tombstone', id, at: new Date().toISOString() });
    this.index.delete(id);
    return existed;
  }

  /**
   * Withdraws every declaration for one author THAT THIS KEY PUBLISHED.
   * Returns the number withdrawn.
   *
   * The `holderPubKey` half of the filter is the scope rule from B-20 option A:
   * a clear may only reach records whose registered verification key is the one
   * that signed the clear. An authorCommitment is a deterministic hash and
   * therefore not a secret, so a commitment-only filter would let anyone who
   * ever saw a commitment wipe that holder -- the exact capability this scheme
   * exists to remove. It also bounds the blast radius of a device that a holder
   * re-keyed away from: the old key clears only what the old key published.
   */
  clearAuthor(authorCommitment: string, holderPubKey: string): number {
    const ids = [...this.index.values()]
      .filter((d) => d.facets.authorCommitment === authorCommitment && d.holderPubKey === holderPubKey)
      .map((d) => d.id);
    for (const id of ids) this.withdraw(id);
    return ids.length;
  }

  get(id: string): PublishedDeclaration | undefined {
    return this.index.get(id);
  }

  listByAuthor(authorCommitment: string): PublishedDeclaration[] {
    return [...this.index.values()].filter((d) => d.facets.authorCommitment === authorCommitment);
  }

  /** Declarations whose facets match the query's category and region. Used both to build the
   *  candidate set for evaluateFloor and, on a hit, as the source of the returned records. */
  matching(category: string, regionCode: string): PublishedDeclaration[] {
    return [...this.index.values()].filter(
      (d) => d.facets.category === category && d.facets.regionCode === regionCode,
    );
  }

  /** Every facet set currently indexed, for requiresSoleAuthorAck's corpus argument. */
  allFacets(): DeclarationFacets[] {
    return [...this.index.values()].map((d) => d.facets);
  }

  get size(): number {
    return this.index.size;
  }
}
