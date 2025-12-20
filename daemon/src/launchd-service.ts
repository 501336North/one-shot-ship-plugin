/**
 * LaunchdService - Manages daemon lifecycle on macOS via launchd
 *
 * Generates plist files and provides commands for loading/unloading the daemon.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface LaunchdConfig {
  ossDir: string;
  label: string;
  daemonPath?: string;
}

export class LaunchdService {
  private config: LaunchdConfig;

  constructor(config: LaunchdConfig) {
    this.config = {
      ...config,
      daemonPath: config.daemonPath || 'oss-daemon'
    };
  }

  /**
   * Generate launchd plist XML content
   */
  generatePlist(): string {
    const { label, ossDir, daemonPath } = this.config;

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${daemonPath}</string>
        <string>start</string>
    </array>

    <key>WorkingDirectory</key>
    <string>${ossDir}</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>${ossDir}/daemon.log</string>

    <key>StandardErrorPath</key>
    <string>${ossDir}/daemon.error.log</string>
</dict>
</plist>`;
  }

  /**
   * Get the path where the plist file should be installed
   */
  getPlistPath(): string {
    const home = process.env.HOME || '/tmp';
    return path.join(home, 'Library', 'LaunchAgents', `${this.config.label}.plist`);
  }

  /**
   * Write plist file to LaunchAgents directory
   */
  async writePlist(): Promise<string> {
    const plistPath = this.getPlistPath();
    const plistDir = path.dirname(plistPath);

    // Ensure LaunchAgents directory exists
    await fs.mkdir(plistDir, { recursive: true });

    // Write plist content
    const plistContent = this.generatePlist();
    await fs.writeFile(plistPath, plistContent, 'utf-8');

    return plistPath;
  }

  /**
   * Check if the service plist file is installed
   */
  async isInstalled(): Promise<boolean> {
    try {
      await fs.access(this.getPlistPath());
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if the service is currently running
   */
  async isRunning(): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`launchctl list | grep ${this.config.label}`);
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get the launchctl load command
   */
  getLoadCommand(): string {
    return `launchctl load ${this.getPlistPath()}`;
  }

  /**
   * Get the launchctl unload command
   */
  getUnloadCommand(): string {
    return `launchctl unload ${this.getPlistPath()}`;
  }

  /**
   * Load the service using launchctl
   */
  async load(): Promise<void> {
    await execAsync(this.getLoadCommand());
  }

  /**
   * Unload the service using launchctl
   */
  async unload(): Promise<void> {
    await execAsync(this.getUnloadCommand());
  }

  /**
   * Remove the plist file
   */
  async uninstall(): Promise<void> {
    try {
      // Unload first if running
      if (await this.isRunning()) {
        await this.unload();
      }
      // Remove plist file
      await fs.unlink(this.getPlistPath());
    } catch {
      // Ignore errors during uninstall
    }
  }
}
