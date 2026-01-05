/**
 * Startup Optimizer Service
 *
 * Reduces command initialization time to <100ms through caching
 * and parallel pre-warming of authentication and IRON LAWS.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface StartupOptimizerOptions {
  authCacheTtl?: number;
  ironLawsCacheTtl?: number;
}

interface AuthResult {
  authenticated: boolean;
  apiKey?: string;
  fromCache?: boolean;
}

interface CachedAuth {
  authenticated: boolean;
  apiKey?: string;
  cachedAt?: number;
}

interface IronLawsResult {
  laws: string[];
  fromCache: boolean;
}

interface CachedIronLaws {
  laws: string[];
  cachedAt: number;
}

interface PreWarmResult {
  authStatus: string;
  ironLawsStatus: string;
  totalTime: number;
}

interface QuickStartResult {
  ready: boolean;
  authenticated: boolean;
  hasIronLaws: boolean;
}

interface InitializeResult {
  ready: boolean;
  command: string;
  error?: string;
}

interface LatencyMetrics {
  lastStartupTime: number;
  averageStartupTime: number;
  cacheHitRate: number;
}

const DEFAULT_AUTH_CACHE_TTL = 60000; // 1 minute
const DEFAULT_IRON_LAWS_CACHE_TTL = 300000; // 5 minutes
const MAX_STARTUP_TIMES = 100; // Cap startup times array to prevent unbounded growth

export class StartupOptimizer {
  private authCacheTtl: number;
  private ironLawsCacheTtl: number;
  private cachedAuth: CachedAuth | null = null;
  private cachedIronLaws: CachedIronLaws | null = null;
  private startupTimes: number[] = [];
  private cacheHits = 0;
  private cacheAccesses = 0;

  constructor(options: StartupOptimizerOptions = {}) {
    this.authCacheTtl = options.authCacheTtl ?? DEFAULT_AUTH_CACHE_TTL;
    this.ironLawsCacheTtl = options.ironLawsCacheTtl ?? DEFAULT_IRON_LAWS_CACHE_TTL;
  }

  /**
   * Check authentication status with caching
   */
  async checkAuth(): Promise<AuthResult> {
    const now = Date.now();

    // Check if cache is valid
    if (this.cachedAuth && this.cachedAuth.cachedAt) {
      const age = now - this.cachedAuth.cachedAt;
      if (age < this.authCacheTtl) {
        this.recordCacheAccess(true);
        return {
          authenticated: this.cachedAuth.authenticated,
          apiKey: this.cachedAuth.apiKey,
          fromCache: true,
        };
      }
    }

    // Read from disk
    this.recordCacheAccess(false);
    const configPath = path.join(os.homedir(), '.oss', 'config.json');

    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(content);
        const result: AuthResult = {
          authenticated: !!config.apiKey,
          apiKey: config.apiKey,
          fromCache: false,
        };

        // Update cache
        this.cachedAuth = {
          authenticated: result.authenticated,
          apiKey: result.apiKey,
          cachedAt: now,
        };

        return result;
      }
    } catch {
      // Config file doesn't exist or is invalid
    }

    // No valid config found
    this.cachedAuth = {
      authenticated: false,
      cachedAt: now,
    };

    return { authenticated: false, fromCache: false };
  }

  /**
   * Get IRON LAWS with caching
   */
  async getIronLaws(): Promise<IronLawsResult> {
    const now = Date.now();

    // Check if cache is valid
    if (this.cachedIronLaws) {
      const age = now - this.cachedIronLaws.cachedAt;
      if (age < this.ironLawsCacheTtl) {
        this.recordCacheAccess(true);
        return {
          laws: this.cachedIronLaws.laws,
          fromCache: true,
        };
      }
    }

    // Would normally fetch from API, but for now return empty
    // This will be connected to the actual API in production
    this.recordCacheAccess(false);
    return {
      laws: [],
      fromCache: false,
    };
  }

  /**
   * Set cached authentication (for testing and pre-population)
   */
  setCachedAuth(auth: CachedAuth): void {
    this.cachedAuth = {
      ...auth,
      cachedAt: auth.cachedAt ?? Date.now(),
    };
  }

  /**
   * Set cached IRON LAWS (for testing and pre-population)
   */
  setCachedIronLaws(laws: CachedIronLaws): void {
    this.cachedIronLaws = laws;
  }

  /**
   * Pre-warm the cache by loading auth and IRON LAWS in parallel
   */
  async preWarm(): Promise<PreWarmResult> {
    const start = Date.now();

    // Run in parallel
    const [authResult, lawsResult] = await Promise.all([
      this.checkAuth(),
      this.getIronLaws(),
    ]);

    const totalTime = Date.now() - start;

    // Cap array to prevent unbounded growth
    if (this.startupTimes.length >= MAX_STARTUP_TIMES) {
      this.startupTimes.shift();
    }
    this.startupTimes.push(totalTime);

    return {
      authStatus: authResult.authenticated ? 'authenticated' : 'unauthenticated',
      ironLawsStatus: lawsResult.laws.length > 0 ? 'loaded' : 'empty',
      totalTime,
    };
  }

  /**
   * Quick start check - returns immediately with cached data status
   */
  quickStart(): QuickStartResult {
    const now = Date.now();

    const hasValidAuth = !!(
      this.cachedAuth &&
      this.cachedAuth.cachedAt &&
      (now - this.cachedAuth.cachedAt) < this.authCacheTtl
    );

    const hasValidIronLaws = !!(
      this.cachedIronLaws &&
      (now - this.cachedIronLaws.cachedAt) < this.ironLawsCacheTtl
    );

    return {
      ready: hasValidAuth && hasValidIronLaws,
      authenticated: hasValidAuth && this.cachedAuth?.authenticated === true,
      hasIronLaws: hasValidIronLaws,
    };
  }

  /**
   * Initialize a command with fast startup
   */
  async initializeCommand(command: string): Promise<InitializeResult> {
    // Try quick start first
    const quickResult = this.quickStart();

    if (quickResult.ready) {
      return {
        ready: true,
        command,
      };
    }

    // Need to load data
    await this.preWarm();

    const afterWarm = this.quickStart();

    if (!afterWarm.authenticated) {
      return {
        ready: false,
        command,
        error: 'Not authenticated. Run /oss:login first.',
      };
    }

    return {
      ready: true,
      command,
    };
  }

  /**
   * Record a cache access for metrics
   */
  recordCacheAccess(hit: boolean): void {
    this.cacheAccesses++;
    if (hit) {
      this.cacheHits++;
    }
  }

  /**
   * Get latency metrics
   */
  getLatencyMetrics(): LatencyMetrics {
    const lastStartupTime = this.startupTimes.length > 0
      ? this.startupTimes[this.startupTimes.length - 1]
      : 0;

    const averageStartupTime = this.startupTimes.length > 0
      ? this.startupTimes.reduce((a, b) => a + b, 0) / this.startupTimes.length
      : 0;

    const cacheHitRate = this.cacheAccesses > 0
      ? this.cacheHits / this.cacheAccesses
      : 0;

    return {
      lastStartupTime,
      averageStartupTime,
      cacheHitRate,
    };
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.cachedAuth = null;
    this.cachedIronLaws = null;
  }
}
