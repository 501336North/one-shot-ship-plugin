/**
 * @behavior Startup optimizer reduces command initialization time to <100ms
 * @acceptance-criteria Commands start quickly with cached auth and pre-loaded data
 * @business-rule Fast feedback loops improve developer experience
 * @boundary Service (StartupOptimizer)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Startup Optimizer Service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('authentication caching', () => {
    /**
     * @behavior Auth check should be fast with caching
     * @acceptance-criteria Cached auth returns in <10ms
     */
    it('should cache authentication status', async () => {
      const { StartupOptimizer } = await import('../../src/services/startup-optimizer');

      const optimizer = new StartupOptimizer();

      // First call - reads from disk
      const result1 = await optimizer.checkAuth();
      expect(result1.fromCache).toBe(false); // First call is not cached

      // Second call - from cache
      const result2 = await optimizer.checkAuth();
      expect(result2.fromCache).toBe(true); // Second call is cached

      // Auth status should match
      expect(result1.authenticated).toBe(result2.authenticated);
    });

    /**
     * @behavior Cache should expire after TTL
     * @acceptance-criteria Auth cache TTL is configurable
     */
    it('should respect cache TTL', async () => {
      const { StartupOptimizer } = await import('../../src/services/startup-optimizer');

      const optimizer = new StartupOptimizer({ authCacheTtl: 5000 }); // 5 second TTL

      const result1 = await optimizer.checkAuth();

      // Advance time past TTL
      vi.advanceTimersByTime(6000);

      // Should refetch after TTL
      const result2 = await optimizer.checkAuth();
      expect(result2.fromCache).toBe(false);
    });
  });

  describe('IRON LAWS caching', () => {
    /**
     * @behavior IRON LAWS should be cached to avoid HTTP latency
     * @acceptance-criteria Cached IRON LAWS return in <5ms
     */
    it('should cache IRON LAWS', async () => {
      const { StartupOptimizer } = await import('../../src/services/startup-optimizer');

      const optimizer = new StartupOptimizer();

      // Simulate cached IRON LAWS
      optimizer.setCachedIronLaws({
        laws: ['LAW1', 'LAW2'],
        cachedAt: Date.now(),
      });

      const result = await optimizer.getIronLaws();

      expect(result.fromCache).toBe(true);
      expect(result.laws).toContain('LAW1');
    });

    /**
     * @behavior Should fetch IRON LAWS if cache is empty
     * @acceptance-criteria Empty cache triggers network fetch
     */
    it('should fetch IRON LAWS if cache is empty', async () => {
      const { StartupOptimizer } = await import('../../src/services/startup-optimizer');

      const optimizer = new StartupOptimizer();

      // No cached laws - should trigger fetch
      const result = await optimizer.getIronLaws();

      expect(result.fromCache).toBe(false);
    });
  });

  describe('pre-warming', () => {
    /**
     * @behavior Pre-warm should load auth and IRON LAWS in parallel
     * @acceptance-criteria Pre-warm completes in <100ms on cache hit
     */
    it('should pre-warm cache on startup', async () => {
      const { StartupOptimizer } = await import('../../src/services/startup-optimizer');

      const optimizer = new StartupOptimizer();

      const result = await optimizer.preWarm();

      expect(result.authStatus).toBeDefined();
      expect(result.ironLawsStatus).toBeDefined();
      expect(result.totalTime).toBeDefined();
    });

    /**
     * @behavior Pre-warm should run auth and IRON LAWS in parallel
     * @acceptance-criteria Parallel execution reduces total time
     */
    it('should execute pre-warm in parallel', async () => {
      const { StartupOptimizer } = await import('../../src/services/startup-optimizer');

      const optimizer = new StartupOptimizer();

      // Mock slow operations
      vi.spyOn(optimizer, 'checkAuth').mockImplementation(async () => {
        await new Promise(r => setTimeout(r, 50));
        return { authenticated: false, fromCache: false };
      });
      vi.spyOn(optimizer, 'getIronLaws').mockImplementation(async () => {
        await new Promise(r => setTimeout(r, 50));
        return { laws: [], fromCache: false };
      });

      vi.useRealTimers();
      const start = Date.now();
      await optimizer.preWarm();
      const duration = Date.now() - start;

      // Parallel should be ~50ms, not 100ms
      expect(duration).toBeLessThan(80);
    });
  });

  describe('quick start', () => {
    /**
     * @behavior Quick start should return immediately with cached data
     * @acceptance-criteria Quick start completes in <10ms with cache
     */
    it('should provide quick start data', async () => {
      const { StartupOptimizer } = await import('../../src/services/startup-optimizer');

      const optimizer = new StartupOptimizer();

      // Pre-populate cache
      optimizer.setCachedAuth({ authenticated: true, apiKey: 'test-key' });
      optimizer.setCachedIronLaws({ laws: ['LAW1'], cachedAt: Date.now() });

      const result = optimizer.quickStart();

      expect(result.ready).toBe(true);
      expect(result.authenticated).toBe(true);
      expect(result.hasIronLaws).toBe(true);
    });

    /**
     * @behavior Quick start should indicate when cache is stale
     * @acceptance-criteria Stale cache returns ready=false
     */
    it('should indicate stale cache', async () => {
      const { StartupOptimizer } = await import('../../src/services/startup-optimizer');

      const optimizer = new StartupOptimizer({ ironLawsCacheTtl: 1000 });

      // Pre-populate with old data
      optimizer.setCachedIronLaws({ laws: ['LAW1'], cachedAt: Date.now() - 2000 });

      const result = optimizer.quickStart();

      expect(result.hasIronLaws).toBe(false); // Cache is stale
    });
  });

  describe('latency tracking', () => {
    /**
     * @behavior Should track startup latency metrics
     * @acceptance-criteria Latency metrics are recorded
     */
    it('should track startup latency', async () => {
      const { StartupOptimizer } = await import('../../src/services/startup-optimizer');

      const optimizer = new StartupOptimizer();

      await optimizer.preWarm();

      const metrics = optimizer.getLatencyMetrics();

      expect(metrics.lastStartupTime).toBeDefined();
      expect(metrics.averageStartupTime).toBeDefined();
      expect(metrics.cacheHitRate).toBeDefined();
    });

    /**
     * @behavior Should calculate cache hit rate
     * @acceptance-criteria Hit rate is percentage of cache hits
     */
    it('should calculate cache hit rate', async () => {
      const { StartupOptimizer } = await import('../../src/services/startup-optimizer');

      const optimizer = new StartupOptimizer();

      // Simulate cache hits/misses
      optimizer.recordCacheAccess(true);  // hit
      optimizer.recordCacheAccess(true);  // hit
      optimizer.recordCacheAccess(false); // miss

      const metrics = optimizer.getLatencyMetrics();

      expect(metrics.cacheHitRate).toBeCloseTo(0.67, 1);
    });
  });

  describe('command initialization', () => {
    /**
     * @behavior Initialize command should be fast
     * @acceptance-criteria Command init completes in <100ms with cache
     */
    it('should initialize command quickly', async () => {
      const { StartupOptimizer } = await import('../../src/services/startup-optimizer');

      const optimizer = new StartupOptimizer();

      // Pre-populate cache
      optimizer.setCachedAuth({ authenticated: true, apiKey: 'test-key' });
      optimizer.setCachedIronLaws({ laws: ['LAW1'], cachedAt: Date.now() });

      vi.useRealTimers();
      const start = Date.now();
      const result = await optimizer.initializeCommand('plan');
      const duration = Date.now() - start;

      expect(result.ready).toBe(true);
      expect(result.command).toBe('plan');
      expect(duration).toBeLessThan(100);
    });

    /**
     * @behavior Should return not ready if auth fails
     * @acceptance-criteria Unauthenticated returns ready=false
     */
    it('should return not ready if unauthenticated', async () => {
      const { StartupOptimizer } = await import('../../src/services/startup-optimizer');

      const optimizer = new StartupOptimizer();

      // Mock checkAuth to always return unauthenticated
      vi.spyOn(optimizer, 'checkAuth').mockResolvedValue({
        authenticated: false,
        fromCache: false,
      });

      const result = await optimizer.initializeCommand('plan');

      expect(result.ready).toBe(false);
      expect(result.error).toContain('auth');
    });
  });
});
