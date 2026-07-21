/**
 * BoundedLruSet - a membership set with least-recently-used eviction.
 *
 * Behaves like a `Set<string>` for `has`/`add`, but caps its size: once the cap
 * is exceeded, the least-recently-used key is evicted. Both `has` (on a hit) and
 * `add` mark a key as most-recently-used, so entries that are still actively
 * consulted survive eviction while ancient, untouched ones eventually free their
 * slot.
 *
 * Used by WatcherSupervisor for `processedIssueSignatures` and
 * `notifiedHealthcheckIssues`, which previously only ever grew (unbounded memory
 * over a long session). The cap is chosen high enough that a realistic session
 * never evicts an ACTIVE dedup entry.
 *
 * Backed by a Map, which preserves insertion order — the first key returned by
 * `keys()` is always the least-recently-used.
 */
export class BoundedLruSet {
    limit;
    entries = new Map();
    constructor(limit) {
        this.limit = limit;
        if (limit < 1) {
            throw new Error(`BoundedLruSet limit must be >= 1, got ${limit}`);
        }
    }
    /**
     * Returns whether the key is present. On a hit, the key is refreshed to
     * most-recently-used so continued dedup checks keep it alive.
     */
    has(key) {
        if (!this.entries.has(key)) {
            return false;
        }
        // Refresh recency: delete + re-insert moves it to the end (most recent).
        this.entries.delete(key);
        this.entries.set(key, true);
        return true;
    }
    /**
     * Adds (or refreshes) a key, evicting the least-recently-used key if the cap
     * is exceeded.
     */
    add(key) {
        if (this.entries.has(key)) {
            this.entries.delete(key);
        }
        this.entries.set(key, true);
        while (this.entries.size > this.limit) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            this.entries.delete(oldest);
        }
    }
    get size() {
        return this.entries.size;
    }
}
//# sourceMappingURL=lru-set.js.map