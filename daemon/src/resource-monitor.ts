/**
 * ResourceMonitor - Tracks system memory and CPU usage
 *
 * Monitors system resources and provides alerts when thresholds are exceeded.
 */

import * as os from 'os';

export interface MemoryUsage {
  totalMB: number;
  usedMB: number;
  freeMB: number;
  usedPercent: number;
}

export interface CpuUsage {
  percent: number;
  cores: number;
}

export interface ResourceUsage {
  memory: MemoryUsage;
  cpu: CpuUsage;
}

export interface ResourceThresholds {
  memoryPercent: number;
  cpuPercent: number;
}

export interface ResourceAlert {
  type: 'memory' | 'cpu';
  message: string;
  value: number;
  threshold: number;
}

export class ResourceMonitor {
  /**
   * Get current system memory usage
   */
  getMemoryUsage(): MemoryUsage {
    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const usedBytes = totalBytes - freeBytes;

    const totalMB = totalBytes / (1024 * 1024);
    const freeMB = freeBytes / (1024 * 1024);
    const usedMB = usedBytes / (1024 * 1024);
    const usedPercent = (usedBytes / totalBytes) * 100;

    return {
      totalMB,
      usedMB,
      freeMB,
      usedPercent
    };
  }

  /**
   * Get CPU usage over a sample period
   * @param sampleMs Duration to sample CPU usage in milliseconds
   */
  async getCpuUsage(sampleMs: number = 1000): Promise<CpuUsage> {
    const cpus = os.cpus();
    const cores = cpus.length;

    // Get initial CPU times
    const startTimes = this.getCpuTimes();

    // Wait for sample period
    await new Promise(resolve => setTimeout(resolve, sampleMs));

    // Get end CPU times
    const endTimes = this.getCpuTimes();

    // Calculate usage
    let totalIdle = 0;
    let totalTick = 0;

    for (let i = 0; i < cores; i++) {
      const idleDiff = endTimes[i].idle - startTimes[i].idle;
      const totalDiff = endTimes[i].total - startTimes[i].total;
      totalIdle += idleDiff;
      totalTick += totalDiff;
    }

    const percent = totalTick > 0 ? ((totalTick - totalIdle) / totalTick) * 100 : 0;

    return {
      percent,
      cores
    };
  }

  /**
   * Get CPU times for all cores
   */
  private getCpuTimes(): Array<{ idle: number; total: number }> {
    return os.cpus().map(cpu => {
      const times = cpu.times;
      const idle = times.idle;
      const total = times.user + times.nice + times.sys + times.idle + times.irq;
      return { idle, total };
    });
  }

  /**
   * Check resource usage against thresholds and return alerts
   */
  checkThresholds(usage: ResourceUsage, thresholds: ResourceThresholds): ResourceAlert[] {
    const alerts: ResourceAlert[] = [];

    if (usage.memory.usedPercent > thresholds.memoryPercent) {
      alerts.push({
        type: 'memory',
        message: `Memory usage at ${usage.memory.usedPercent}% exceeds threshold of ${thresholds.memoryPercent}%`,
        value: usage.memory.usedPercent,
        threshold: thresholds.memoryPercent
      });
    }

    if (usage.cpu.percent > thresholds.cpuPercent) {
      alerts.push({
        type: 'cpu',
        message: `CPU usage at ${usage.cpu.percent}% exceeds threshold of ${thresholds.cpuPercent}%`,
        value: usage.cpu.percent,
        threshold: thresholds.cpuPercent
      });
    }

    return alerts;
  }

  /**
   * Get complete resource usage snapshot
   */
  async getResourceUsage(): Promise<ResourceUsage> {
    const memory = this.getMemoryUsage();
    const cpu = await this.getCpuUsage(100); // Quick sample for snapshot

    return {
      memory,
      cpu
    };
  }
}
