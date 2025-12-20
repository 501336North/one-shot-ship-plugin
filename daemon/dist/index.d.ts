/**
 * OSS Supervisor Daemon
 *
 * Standalone process monitor for detecting and killing hung processes.
 */
export { OssDaemon, DaemonConfig } from './daemon.js';
export { ProcessMonitor, ProcessInfo, ProcessType } from './process-monitor.js';
export { HungProcessKiller, KillResult, TimeoutConfig, HungProcessKillerConfig } from './hung-process-killer.js';
export { ResourceMonitor, ResourceUsage, MemoryUsage, CpuUsage, ResourceThresholds, ResourceAlert } from './resource-monitor.js';
export { LaunchdService, LaunchdConfig } from './launchd-service.js';
export { HealthCheckScheduler, SchedulerConfig, HealthCheckResult } from './health-check-scheduler.js';
export { DaemonCli, CliConfig, CliCommand, CliResult } from './cli.js';
//# sourceMappingURL=index.d.ts.map