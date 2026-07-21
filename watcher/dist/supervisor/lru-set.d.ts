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
export declare class BoundedLruSet {
    private readonly limit;
    private readonly entries;
    constructor(limit: number);
    /**
     * Returns whether the key is present. On a hit, the key is refreshed to
     * most-recently-used so continued dedup checks keep it alive.
     */
    has(key: string): boolean;
    /**
     * Adds (or refreshes) a key, evicting the least-recently-used key if the cap
     * is exceeded.
     */
    add(key: string): void;
    get size(): number;
}
//# sourceMappingURL=lru-set.d.ts.map