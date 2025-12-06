import * as fs from 'fs';
import * as path from 'path';
import { QueueManager } from './queue/manager.js';
import { RuleEngine } from './detectors/rules.js';
import { LogMonitor } from './monitors/log-monitor.js';
import { TestMonitor } from './monitors/test-monitor.js';
import { GitMonitor } from './monitors/git-monitor.js';
import { LLMAnalyzer } from './detectors/llm-analyzer.js';
import { WatcherConfig, DEFAULT_CONFIG } from './types.js';

/**
 * Watcher state enum
 */
export enum WatcherState {
  Idle = 'idle',
  Running = 'running',
  Stopped = 'stopped',
}

/**
 * Main Watcher Process
 *
 * Implements US-001 from REQUIREMENTS.md
 */
export class Watcher {
  private readonly ossDir: string;
  private readonly apiKey: string;
  private readonly pidPath: string;
  private readonly logPath: string;
  private readonly configPath: string;

  private state: WatcherState = WatcherState.Idle;
  private queueManager: QueueManager | null = null;
  private ruleEngine: RuleEngine | null = null;
  private logMonitor: LogMonitor | null = null;
  private testMonitor: TestMonitor | null = null;
  private gitMonitor: GitMonitor | null = null;
  private llmAnalyzer: LLMAnalyzer | null = null;
  private config: WatcherConfig = DEFAULT_CONFIG;

  constructor(ossDir: string, apiKey: string) {
    this.ossDir = ossDir;
    this.apiKey = apiKey;
    this.pidPath = path.join(ossDir, 'watcher.pid');
    this.logPath = path.join(ossDir, 'watcher.log');
    this.configPath = path.join(ossDir, 'config.json');
  }

  /**
   * Start the watcher process
   * @returns true if started, false if another watcher already running
   */
  async start(): Promise<boolean> {
    // Check for existing watcher
    if (await this.isAnotherWatcherRunning()) {
      return false;
    }

    // Clean up any stale PID file
    await this.cleanupStalePidFile();

    // Load configuration
    this.config = await this.loadConfig();

    // Create PID file
    fs.writeFileSync(this.pidPath, process.pid.toString());

    // Initialize log file
    this.log('Watcher started');

    // Initialize components
    this.queueManager = new QueueManager(this.ossDir, this.config.max_queue_size);
    await this.queueManager.initialize();

    this.ruleEngine = new RuleEngine(this.config.loop_detection_threshold);

    this.logMonitor = new LogMonitor(
      this.queueManager,
      this.ruleEngine,
      100 // buffer size
    );

    this.testMonitor = new TestMonitor(this.queueManager);

    this.gitMonitor = new GitMonitor(this.queueManager);

    if (this.config.use_llm_analysis) {
      this.llmAnalyzer = new LLMAnalyzer(
        this.queueManager,
        this.ruleEngine,
        this.apiKey,
        this.config.llm_confidence_threshold
      );
    }

    this.state = WatcherState.Running;
    return true;
  }

  /**
   * Stop the watcher process
   */
  async stop(): Promise<void> {
    if (this.state === WatcherState.Stopped) {
      return;
    }

    this.log('Watcher stopped');
    this.state = WatcherState.Stopped;

    // Remove PID file
    if (fs.existsSync(this.pidPath)) {
      fs.unlinkSync(this.pidPath);
    }

    // Clear references
    this.queueManager = null;
    this.ruleEngine = null;
    this.logMonitor = null;
    this.testMonitor = null;
    this.gitMonitor = null;
    this.llmAnalyzer = null;
  }

  /**
   * Get current watcher state
   */
  getState(): WatcherState {
    return this.state;
  }

  /**
   * Check if another watcher process is running
   */
  async isAnotherWatcherRunning(): Promise<boolean> {
    if (!fs.existsSync(this.pidPath)) {
      return false;
    }

    const pidContent = fs.readFileSync(this.pidPath, 'utf-8').trim();
    const pid = parseInt(pidContent, 10);

    if (isNaN(pid)) {
      return false;
    }

    // Check if process exists
    try {
      process.kill(pid, 0); // Signal 0 just checks if process exists
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clean up stale PID file if process not running
   */
  async cleanupStalePidFile(): Promise<void> {
    if (!fs.existsSync(this.pidPath)) {
      return;
    }

    const isRunning = await this.isAnotherWatcherRunning();
    if (!isRunning) {
      fs.unlinkSync(this.pidPath);
    }
  }

  /**
   * Load configuration from file or use defaults
   */
  async loadConfig(): Promise<WatcherConfig> {
    if (!fs.existsSync(this.configPath)) {
      return DEFAULT_CONFIG;
    }

    try {
      const content = fs.readFileSync(this.configPath, 'utf-8');
      const config = JSON.parse(content) as WatcherConfig;
      return { ...DEFAULT_CONFIG, ...config };
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  /**
   * Process a log line (for integration with Claude Code hooks)
   */
  async processLog(line: string): Promise<void> {
    if (!this.logMonitor || !this.config.monitors.logs) {
      return;
    }
    await this.logMonitor.processLine(line);
  }

  /**
   * Get the queue manager (for hooks)
   */
  getQueueManager(): QueueManager | null {
    return this.queueManager;
  }

  /**
   * Get the log monitor (for hooks)
   */
  getLogMonitor(): LogMonitor | null {
    return this.logMonitor;
  }

  /**
   * Get the test monitor (for hooks)
   */
  getTestMonitor(): TestMonitor | null {
    return this.testMonitor;
  }

  /**
   * Get the git monitor (for hooks)
   */
  getGitMonitor(): GitMonitor | null {
    return this.gitMonitor;
  }

  /**
   * Write to log file with timestamp
   */
  private log(message: string): void {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}\n`;

    fs.appendFileSync(this.logPath, logLine);
  }
}

// Export all components for use by hooks
export { QueueManager } from './queue/manager.js';
export { RuleEngine, RuleMatch } from './detectors/rules.js';
export { LogMonitor } from './monitors/log-monitor.js';
export { TestMonitor, TestResult } from './monitors/test-monitor.js';
export { GitMonitor, CIStatus, PRCheckResult } from './monitors/git-monitor.js';
export { LLMAnalyzer, LLMAnalysisResult } from './detectors/llm-analyzer.js';
export * from './types.js';
