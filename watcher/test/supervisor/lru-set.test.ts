/**
 * BoundedLruSet Tests (perf T16)
 *
 * @behavior A membership set that dedups like Set but evicts least-recently-used
 *           keys once it exceeds a cap, so a long watcher session cannot grow the
 *           processed-signature / notified-issue caches without bound.
 * @business-rule Dedup memory stays bounded; realistic sessions never evict an
 *                ACTIVE dedup entry, but ancient ones eventually free their slot.
 */

import { describe, it, expect } from 'vitest';
import { BoundedLruSet } from '../../src/supervisor/lru-set.js';

describe('BoundedLruSet (perf T16)', () => {
  it('dedups membership like a Set within the cap', () => {
    const set = new BoundedLruSet(10);
    expect(set.has('a')).toBe(false);
    set.add('a');
    expect(set.has('a')).toBe(true);
    // Re-adding is idempotent
    set.add('a');
    expect(set.size).toBe(1);
  });

  it('never exceeds its cap under many unique keys', () => {
    const cap = 50;
    const set = new BoundedLruSet(cap);
    for (let i = 0; i < cap * 20; i++) {
      set.add(`sig-${i}`);
    }
    expect(set.size).toBeLessThanOrEqual(cap);
  });

  it('evicts the oldest key so a very old signature can re-fire', () => {
    const set = new BoundedLruSet(3);
    set.add('oldest');
    set.add('b');
    set.add('c');
    // Overflow — 'oldest' is the least-recently-used and must be evicted
    set.add('d');
    expect(set.has('oldest')).toBe(false); // evicted → would re-fire
    expect(set.has('d')).toBe(true); // recent → still deduped
  });

  it('keeps a recently-used key alive across eviction pressure (LRU refresh)', () => {
    const set = new BoundedLruSet(3);
    set.add('keep');
    set.add('b');
    set.add('c');
    // Touch 'keep' so it becomes most-recently-used
    expect(set.has('keep')).toBe(true);
    // Now overflow: the LRU victim should be 'b' (oldest untouched), not 'keep'
    set.add('d');
    expect(set.has('keep')).toBe(true);
    expect(set.has('b')).toBe(false);
  });

  it('re-adding an existing key refreshes its recency so it survives eviction', () => {
    const set = new BoundedLruSet(3);
    set.add('keep');
    set.add('b');
    set.add('c');
    // Re-add 'keep' (not has()) — add() on an existing key must also promote it
    // to most-recently-used, not leave it as the eviction victim.
    set.add('keep');
    expect(set.size).toBe(3); // still deduped, no growth
    // Overflow: the LRU victim should be 'b' (oldest untouched), not 'keep'
    set.add('d');
    expect(set.has('keep')).toBe(true);
    expect(set.has('b')).toBe(false);
  });

  it('rejects a non-positive cap (a zero-capacity dedup set is meaningless)', () => {
    expect(() => new BoundedLruSet(0)).toThrow();
  });
});
