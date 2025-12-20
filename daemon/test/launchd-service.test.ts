/**
 * @behavior launchd service manages daemon lifecycle on macOS
 * @acceptance-criteria AC-DAEMON-005
 * @business-rule DAEMON-005
 * @boundary System Service
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

import { LaunchdService, LaunchdConfig } from '../src/launchd-service.js';

describe('LaunchdService', () => {
  const testDir = path.join(tmpdir(), `oss-launchd-test-${Date.now()}`);
  let service: LaunchdService;

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
    service = new LaunchdService({
      ossDir: testDir,
      label: 'com.oneshotship.daemon.test'
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('Plist Generation', () => {
    it('should generate valid plist content', () => {
      const plist = service.generatePlist();

      expect(plist).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(plist).toContain('<!DOCTYPE plist');
      expect(plist).toContain('<key>Label</key>');
      expect(plist).toContain('com.oneshotship.daemon.test');
    });

    it('should include program arguments', () => {
      const plist = service.generatePlist();

      expect(plist).toContain('<key>ProgramArguments</key>');
      expect(plist).toContain('oss-daemon');
    });

    it('should configure run at load', () => {
      const plist = service.generatePlist();

      expect(plist).toContain('<key>RunAtLoad</key>');
      expect(plist).toContain('<true/>');
    });

    it('should configure keep alive', () => {
      const plist = service.generatePlist();

      expect(plist).toContain('<key>KeepAlive</key>');
      expect(plist).toContain('<true/>');
    });

    it('should set working directory to oss dir', () => {
      const plist = service.generatePlist();

      expect(plist).toContain('<key>WorkingDirectory</key>');
      expect(plist).toContain(testDir);
    });
  });

  describe('Plist File Management', () => {
    it('should write plist to LaunchAgents directory', async () => {
      const plistPath = await service.writePlist();

      expect(plistPath).toContain('LaunchAgents');
      expect(plistPath).toContain('com.oneshotship.daemon.test.plist');
    });

    it('should get correct plist path', () => {
      const plistPath = service.getPlistPath();

      expect(plistPath).toContain('LaunchAgents');
      expect(plistPath).toContain('com.oneshotship.daemon.test.plist');
    });
  });

  describe('Service Status', () => {
    it('should check if service is installed', async () => {
      const installed = await service.isInstalled();

      // Not installed in test environment
      expect(typeof installed).toBe('boolean');
    });

    it('should check if service is running', async () => {
      const running = await service.isRunning();

      // Not running in test environment
      expect(typeof running).toBe('boolean');
    });
  });

  describe('launchctl Commands', () => {
    it('should generate load command', () => {
      const cmd = service.getLoadCommand();

      expect(cmd).toContain('launchctl');
      expect(cmd).toContain('load');
      expect(cmd).toContain('com.oneshotship.daemon.test.plist');
    });

    it('should generate unload command', () => {
      const cmd = service.getUnloadCommand();

      expect(cmd).toContain('launchctl');
      expect(cmd).toContain('unload');
      expect(cmd).toContain('com.oneshotship.daemon.test.plist');
    });
  });
});
