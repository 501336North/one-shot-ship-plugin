/**
 * ProcessMonitor - Detect and track running test processes
 *
 * Finds vitest, npm test, and other test processes and tracks their age
 * to identify hung processes.
 */

import { execSync } from 'child_process';

export type ProcessType = 'vitest' | 'npm-test' | 'jest' | 'node' | 'unknown';

export interface ProcessInfo {
  pid: number;
  command: string;
  startTime: Date;
  cpuPercent: number;
  memoryMB: number;
}

export class ProcessMonitor {
  /**
   * Find processes matching a search term
   */
  async findProcesses(search: string): Promise<ProcessInfo[]> {
    try {
      // Use ps to find processes
      // Format: pid,etime,pcpu,rss,args
      const output = execSync(
        `ps aux | grep -i "${search}" | grep -v grep`,
        { encoding: 'utf-8', timeout: 5000 }
      ).trim();

      if (!output) {
        return [];
      }

      return output.split('\n').map(line => this.parseProcessLine(line));
    } catch {
      // No matching processes or command failed
      return [];
    }
  }

  /**
   * Parse a ps output line into ProcessInfo
   */
  private parseProcessLine(line: string): ProcessInfo {
    // ps aux format: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
    const parts = line.trim().split(/\s+/);

    const pid = parseInt(parts[1]) || 0;
    const cpuPercent = parseFloat(parts[2]) || 0;
    const memoryKB = parseInt(parts[5]) || 0;
    const startStr = parts[8] || '';
    const command = parts.slice(10).join(' ');

    return {
      pid,
      command,
      startTime: this.parseStartTime(startStr),
      cpuPercent,
      memoryMB: memoryKB / 1024
    };
  }

  /**
   * Parse process start time from ps output
   * macOS format: "10:18PM", "9:28AM", "MonDD", etc.
   */
  private parseStartTime(startStr: string): Date {
    const now = new Date();

    // macOS format: HH:MMAM/PM (e.g., "10:18PM", "9:28AM")
    const timeMatch = startStr.match(/^(\d{1,2}):(\d{2})(AM|PM)$/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = parseInt(timeMatch[2]);
      const isPM = timeMatch[3].toUpperCase() === 'PM';

      if (isPM && hours !== 12) hours += 12;
      if (!isPM && hours === 12) hours = 0;

      const date = new Date(now);
      date.setHours(hours, minutes, 0, 0);

      // If time is in future, it was yesterday
      if (date > now) {
        date.setDate(date.getDate() - 1);
      }
      return date;
    }

    // Linux format: HH:MM (24-hour)
    if (startStr.includes(':') && !startStr.includes('AM') && !startStr.includes('PM')) {
      const [hours, minutes] = startStr.split(':').map(Number);
      const date = new Date(now);
      date.setHours(hours, minutes, 0, 0);
      if (date > now) {
        date.setDate(date.getDate() - 1);
      }
      return date;
    }

    // Otherwise, assume it's older (just return a date in the past)
    return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }

  /**
   * Get process age in milliseconds
   */
  getProcessAge(process: ProcessInfo): number {
    return Date.now() - process.startTime.getTime();
  }

  /**
   * Check if process exceeds timeout threshold
   */
  isProcessHung(process: ProcessInfo, timeoutMs: number): boolean {
    return this.getProcessAge(process) > timeoutMs;
  }

  /**
   * Determine process type from command
   */
  getProcessType(command: string): ProcessType {
    const lowerCmd = command.toLowerCase();

    if (lowerCmd.includes('vitest')) {
      return 'vitest';
    }
    if (lowerCmd.includes('npm') && lowerCmd.includes('test')) {
      return 'npm-test';
    }
    if (lowerCmd.includes('jest')) {
      return 'jest';
    }
    if (lowerCmd.includes('node')) {
      return 'node';
    }

    return 'unknown';
  }
}
