/**
 * Onboarding Service
 *
 * Provides streamlined first-time experience with phased setup.
 * Goal: Time-to-first-value under 2 minutes.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  action?: string;
  required: boolean;
}

interface OnboardingPhase {
  name: string;
  description: string;
  estimatedTime: string;
  steps: OnboardingStep[];
}

interface PreflightCheck {
  name: string;
  status: 'pass' | 'fail' | 'warning';
  message: string;
  version?: string;
}

interface HelloWorldDemo {
  title: string;
  description: string;
  steps: { title: string; command: string; output?: string }[];
  requiresAuth: boolean;
}

interface SetupValidation {
  healthy: boolean;
  issues: string[];
  warnings: string[];
}

interface OnboardingOptions {
  configDir?: string;
}

export class OnboardingService {
  private configDir: string;
  private completedSteps: Set<string>;

  constructor(options: OnboardingOptions = {}) {
    this.configDir = options.configDir || path.join(process.env.HOME || '', '.oss');
    this.completedSteps = new Set();
  }

  /**
   * Get the three onboarding phases
   */
  getPhases(): OnboardingPhase[] {
    return [
      {
        name: 'Essential',
        description: 'Get started immediately - just your API key',
        estimatedTime: '1 minute',
        steps: [
          {
            id: 'api-key',
            title: 'Enter API Key',
            description: 'Your OSS API key from oneshotship.com',
            action: '/oss:login',
            required: true,
          },
          {
            id: 'verify-install',
            title: 'Verify Installation',
            description: 'Confirm OSS is working',
            action: '/oss:status',
            required: true,
          },
        ],
      },
      {
        name: 'Recommended',
        description: 'Enhanced features for better experience',
        estimatedTime: '3 minutes',
        steps: [
          {
            id: 'notifications',
            title: 'Enable Notifications',
            description: 'Get desktop notifications for workflow events',
            action: '/oss:settings notifications',
            required: false,
          },
          {
            id: 'supervisor',
            title: 'Start Supervisor',
            description: 'Background agent for health monitoring',
            action: '/oss:watcher start',
            required: false,
          },
        ],
      },
      {
        name: 'Optional',
        description: 'Power user features',
        estimatedTime: '5 minutes',
        steps: [
          {
            id: 'statusline',
            title: 'Configure Status Line',
            description: 'See workflow status in your terminal',
            action: '/oss:settings statusline',
            required: false,
          },
          {
            id: 'tutorials',
            title: 'Complete Tutorials',
            description: 'Learn TDD and the OSS workflow',
            action: '/oss:learn',
            required: false,
          },
        ],
      },
    ];
  }

  /**
   * Get completion percentage
   */
  getCompletionPercentage(): number {
    const phases = this.getPhases();
    const totalSteps = phases.reduce((sum, p) => sum + p.steps.length, 0);

    if (totalSteps === 0) return 0;
    return Math.round((this.completedSteps.size / totalSteps) * 100);
  }

  /**
   * Mark a step as completed
   */
  completeStep(stepId: string): void {
    this.completedSteps.add(stepId);
  }

  /**
   * Get list of completed steps
   */
  getCompletedSteps(): string[] {
    return Array.from(this.completedSteps);
  }

  /**
   * Run pre-flight checks
   */
  async runPreflightChecks(): Promise<PreflightCheck[]> {
    const checks: PreflightCheck[] = [];

    // Check git
    try {
      const gitVersion = execSync('git --version', { encoding: 'utf-8' }).trim();
      checks.push({
        name: 'git',
        status: 'pass',
        message: 'Git is installed',
        version: gitVersion.replace('git version ', ''),
      });
    } catch {
      checks.push({
        name: 'git',
        status: 'fail',
        message: 'Git is not installed or not in PATH',
      });
    }

    // Check node
    try {
      const nodeVersion = execSync('node --version', { encoding: 'utf-8' }).trim();
      checks.push({
        name: 'node',
        status: 'pass',
        message: 'Node.js is installed',
        version: nodeVersion.replace('v', ''),
      });
    } catch {
      checks.push({
        name: 'node',
        status: 'fail',
        message: 'Node.js is not installed or not in PATH',
      });
    }

    // Check npm
    try {
      const npmVersion = execSync('npm --version', { encoding: 'utf-8' }).trim();
      checks.push({
        name: 'npm',
        status: 'pass',
        message: 'npm is installed',
        version: npmVersion,
      });
    } catch {
      checks.push({
        name: 'npm',
        status: 'warning',
        message: 'npm is not installed (optional)',
      });
    }

    // Check Claude Code
    try {
      execSync('which claude', { encoding: 'utf-8' });
      checks.push({
        name: 'claude',
        status: 'pass',
        message: 'Claude Code CLI is installed',
      });
    } catch {
      checks.push({
        name: 'claude',
        status: 'warning',
        message: 'Claude Code CLI not found in PATH',
      });
    }

    return checks;
  }

  /**
   * Get the hello world demo
   */
  getHelloWorldDemo(): HelloWorldDemo {
    return {
      title: 'OSS Hello World',
      description: 'See OSS in action without any configuration',
      requiresAuth: false,
      steps: [
        {
          title: 'Check OSS Status',
          command: '/oss:legend',
          output: 'Displays OSS workflow legend',
        },
        {
          title: 'See Available Commands',
          command: '/oss:oss',
          output: 'Lists all OSS commands',
        },
        {
          title: 'Understand TDD',
          command: 'Run: /oss:explain tdd (after login)',
          output: 'Learn about Test-Driven Development',
        },
      ],
    };
  }

  /**
   * Validate entire setup
   */
  async validateSetup(): Promise<SetupValidation> {
    const issues: string[] = [];
    const warnings: string[] = [];

    // Check config directory
    if (!fs.existsSync(this.configDir)) {
      issues.push('OSS config directory does not exist');
    }

    // Check config file
    const configPath = path.join(this.configDir, 'config.json');
    if (!fs.existsSync(configPath)) {
      issues.push('OSS config file not found - run /oss:login');
    } else {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (!config.apiKey) {
          issues.push('API key not configured - run /oss:login');
        }
      } catch {
        issues.push('Config file is corrupted - run /oss:login');
      }
    }

    // Check pre-flight
    const checks = await this.runPreflightChecks();
    for (const check of checks) {
      if (check.status === 'fail') {
        issues.push(`${check.name}: ${check.message}`);
      } else if (check.status === 'warning') {
        warnings.push(`${check.name}: ${check.message}`);
      }
    }

    return {
      healthy: issues.length === 0,
      issues,
      warnings,
    };
  }

  /**
   * Get current phase based on progress
   */
  getCurrentPhase(): number {
    const phases = this.getPhases();

    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i];
      const phaseComplete = phase.steps.every(
        s => !s.required || this.completedSteps.has(s.id)
      );
      if (!phaseComplete) {
        return i;
      }
    }

    return phases.length - 1; // All complete
  }

  /**
   * Get next step to complete
   */
  getNextStep(): OnboardingStep | null {
    const phases = this.getPhases();

    for (const phase of phases) {
      for (const step of phase.steps) {
        if (!this.completedSteps.has(step.id)) {
          return step;
        }
      }
    }

    return null;
  }
}
