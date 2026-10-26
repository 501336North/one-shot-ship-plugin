import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LLMAnalyzer, LLMAnalysisResult } from '../src/detectors/llm-analyzer';
import { QueueManager } from '../src/queue/manager';
import { RuleEngine } from '../src/detectors/rules';
import { Task } from '../src/types';

// Mock dependencies
vi.mock('../src/queue/manager');
vi.mock('../src/detectors/rules');

/**
 * @behavior LLM analyzer catches nuanced anomalies rules miss
 * @acceptance-criteria AC-006.1, AC-006.2, AC-006.3, AC-006.4, AC-006.5
 */
describe('LLMAnalyzer', () => {
  let analyzer: LLMAnalyzer;
  let mockQueueManager: {
    addTask: ReturnType<typeof vi.fn>;
  };
  let mockRuleEngine: {
    analyze: ReturnType<typeof vi.fn>;
  };
  let mockFetch: ReturnType<typeof vi.fn>;
  const originalFetch = global.fetch;
  let configDir: string;
  let savedConfigDir: string | undefined;
  /** The OSS config the analyzer takes its key and API from (OSS_CONFIG_DIR/config.json, 0600) */
  const writeConfig = (config: Record<string, unknown>): void =>
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(config), { mode: 0o600 });

  beforeEach(() => {
    vi.clearAllMocks();
    savedConfigDir = process.env.OSS_CONFIG_DIR;
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-llm-analyzer-'));
    process.env.OSS_CONFIG_DIR = configDir;
    writeConfig({ apiKey: 'test-api-key' });

    mockQueueManager = {
      addTask: vi.fn().mockResolvedValue({ id: 'task-123' } as Task),
    };

    mockRuleEngine = {
      analyze: vi.fn().mockReturnValue(null), // Rules don't match
    };

    mockFetch = vi.fn();
    global.fetch = mockFetch;

    analyzer = new LLMAnalyzer(
      mockQueueManager as unknown as QueueManager,
      mockRuleEngine as unknown as RuleEngine
    );
  });

  afterEach(() => {
    // Restore original fetch to prevent leaking mock to other test files
    global.fetch = originalFetch;
    if (savedConfigDir === undefined) delete process.env.OSS_CONFIG_DIR;
    else process.env.OSS_CONFIG_DIR = savedConfigDir;
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  // The key goes only to the API the OSS config names (release channels: STAGING / DEV)
  describe('key and API from the OSS config', () => {
    const noAnomaly = { ok: true, json: () => Promise.resolve({ anomaly_detected: false }) };

    it('should send the configured key to the configured API', async () => {
      writeConfig({ apiKey: 'staging-key', apiUrl: 'https://staging.example.com' });
      mockFetch.mockResolvedValue(noAnomaly);

      await analyzer.analyze('logs');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe('https://staging.example.com/api/v1/analyze');
      expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer staging-key');
    });

    it('should use the production API when apiUrl is missing', async () => {
      mockFetch.mockResolvedValue(noAnomaly);

      await analyzer.analyze('logs');

      expect(mockFetch.mock.calls[0][0]).toBe('https://one-shot-ship-api.onrender.com/api/v1/analyze');
    });

    it('should refuse a redirect (never replay the key to another host)', async () => {
      // fetch as the platform implements it: 'follow' (the default) replays the request, Bearer
      // key included, to the Location host; 'manual' hands back the 3xx; 'error' rejects.
      mockFetch.mockImplementation(async (_url: string, init: { redirect?: RequestRedirect }) => {
        if (init.redirect === 'error') throw new TypeError('fetch failed: redirect');
        if (init.redirect === 'manual') return { ok: false, status: 302, json: () => Promise.resolve({}) };
        return {
          ok: true,
          json: () => Promise.resolve({
            anomaly_detected: true, anomaly_type: 'unusual_pattern', priority: 'medium',
            analysis: 'from the redirect target', confidence: 0.99, suggested_agent: 'debugger', prompt: 'p',
          }),
        };
      });

      expect(await analyzer.analyze('logs')).toBeNull();
    });

    it('should send nothing, and not fall back to production, when apiUrl is refused', async () => {
      writeConfig({ apiKey: 'k', apiUrl: 'http://staging.example.com' });
      mockFetch.mockResolvedValue(noAnomaly);

      const result = await analyzer.analyze('logs');

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // AC-006.1: LLM analyzes when rules don't match
  describe('rule fallback', () => {
    it('should not call LLM when rules match', async () => {
      // Rules match
      mockRuleEngine.analyze.mockReturnValue({
        anomaly_type: 'exception',
        priority: 'medium',
        context: {},
        suggested_agent: 'debugger',
        prompt: 'Fix it',
      });

      await analyzer.analyze('Error: something');

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should call LLM when rules return null', async () => {
      mockRuleEngine.analyze.mockReturnValue(null);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          anomaly_detected: false,
        }),
      });

      await analyzer.analyze('Some unusual log pattern');

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should return rule match without LLM call', async () => {
      const ruleMatch = {
        anomaly_type: 'test_failure',
        priority: 'high',
        context: { test_file: 'foo.test.ts' },
        suggested_agent: 'debugger',
        prompt: 'Fix test',
      };
      mockRuleEngine.analyze.mockReturnValue(ruleMatch);

      const result = await analyzer.analyze('FAIL foo.test.ts');

      expect(result).toEqual(ruleMatch);
    });
  });

  // AC-006.2: Identifies "agent seems stuck" patterns
  describe('stuck detection', () => {
    it('should detect stuck patterns from context', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          anomaly_detected: true,
          anomaly_type: 'agent_stuck',
          priority: 'high',
          analysis: 'Agent appears to be stuck in a polling loop',
          confidence: 0.85,
          suggested_agent: 'debugger',
          prompt: 'Break the stuck loop',
        }),
      });

      const result = await analyzer.analyze('Polling for status... (attempt 15)');

      expect(result?.anomaly_type).toBe('agent_stuck');
    });

    it('should include LLM analysis in context', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          anomaly_detected: true,
          anomaly_type: 'agent_stuck',
          priority: 'high',
          analysis: 'Detected repetitive polling pattern',
          confidence: 0.9,
          suggested_agent: 'debugger',
          prompt: 'Investigate stuck state',
        }),
      });

      const result = await analyzer.analyze('waiting...');

      expect(result?.context.analysis).toBe('Detected repetitive polling pattern');
    });
  });

  // AC-006.3: Identifies unusual error patterns
  describe('unusual pattern detection', () => {
    it('should detect unusual patterns', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          anomaly_detected: true,
          anomaly_type: 'unusual_pattern',
          priority: 'medium',
          analysis: 'Unusual memory allocation pattern detected',
          confidence: 0.75,
          suggested_agent: 'performance-engineer',
          prompt: 'Investigate memory issue',
        }),
      });

      const result = await analyzer.analyze('Memory usage spiked to 2GB');

      expect(result?.anomaly_type).toBe('unusual_pattern');
    });

    it('should include confidence score in context', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          anomaly_detected: true,
          anomaly_type: 'unusual_pattern',
          priority: 'medium',
          analysis: 'Detected unusual pattern',
          confidence: 0.82,
          suggested_agent: 'debugger',
          prompt: 'Investigate',
        }),
      });

      const result = await analyzer.analyze('strange behavior');

      expect(result?.context.confidence).toBe(0.82);
    });

    it('should filter low confidence results', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          anomaly_detected: true,
          anomaly_type: 'unusual_pattern',
          priority: 'low',
          analysis: 'Maybe something',
          confidence: 0.3, // Below threshold
          suggested_agent: 'debugger',
          prompt: 'Check it',
        }),
      });

      const result = await analyzer.analyze('normal log');

      expect(result).toBeNull(); // Filtered due to low confidence
    });
  });

  // AC-006.4: Suggests appropriate agent
  describe('agent suggestion', () => {
    it('should recommend agent based on anomaly type', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          anomaly_detected: true,
          anomaly_type: 'recommended_investigation',
          priority: 'medium',
          analysis: 'Performance issue detected',
          confidence: 0.8,
          suggested_agent: 'performance-engineer',
          prompt: 'Optimize performance',
        }),
      });

      const result = await analyzer.analyze('Response time 5000ms');

      expect(result?.suggested_agent).toBe('performance-engineer');
    });
  });

  // AC-006.5: Falls back gracefully if LLM unavailable
  describe('graceful fallback', () => {
    it('should return null if LLM request fails', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await analyzer.analyze('some logs');

      expect(result).toBeNull();
    });

    it('should return null if LLM returns error status', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await analyzer.analyze('some logs');

      expect(result).toBeNull();
    });

    it('should return null if response is malformed', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ invalid: 'response' }),
      });

      const result = await analyzer.analyze('some logs');

      expect(result).toBeNull();
    });

    it('should return null if no anomaly detected', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          anomaly_detected: false,
        }),
      });

      const result = await analyzer.analyze('normal operations');

      expect(result).toBeNull();
    });

    it('should handle timeout gracefully', async () => {
      mockFetch.mockImplementation(() => new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout')), 100);
      }));

      const result = await analyzer.analyze('logs');

      expect(result).toBeNull();
    });
  });

  // Configuration
  describe('configuration', () => {
    it('should respect confidence threshold', async () => {
      const strictAnalyzer = new LLMAnalyzer(
        mockQueueManager as unknown as QueueManager,
        mockRuleEngine as unknown as RuleEngine,
        0.9 // High threshold
      );

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          anomaly_detected: true,
          anomaly_type: 'unusual_pattern',
          priority: 'medium',
          analysis: 'Detected something',
          confidence: 0.85, // Below 0.9 threshold
          suggested_agent: 'debugger',
          prompt: 'Check',
        }),
      });

      const result = await strictAnalyzer.analyze('logs');

      expect(result).toBeNull();
    });

    it('should use default threshold when not specified', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          anomaly_detected: true,
          anomaly_type: 'unusual_pattern',
          priority: 'medium',
          analysis: 'Detected',
          confidence: 0.7, // Default threshold
          suggested_agent: 'debugger',
          prompt: 'Fix',
        }),
      });

      const result = await analyzer.analyze('logs');

      expect(result).not.toBeNull();
    });
  });

  // Task creation
  describe('task creation', () => {
    it('should create task from LLM analysis', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          anomaly_detected: true,
          anomaly_type: 'agent_stuck',
          priority: 'high',
          analysis: 'Agent is stuck',
          confidence: 0.9,
          suggested_agent: 'debugger',
          prompt: 'Fix the stuck agent',
        }),
      });

      await analyzer.analyzeAndReport('stuck logs');

      expect(mockQueueManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          anomaly_type: 'agent_stuck',
          priority: 'high',
          source: 'log-monitor',
          suggested_agent: 'debugger',
        })
      );
    });
  });
});
