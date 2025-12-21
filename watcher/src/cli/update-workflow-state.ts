#!/usr/bin/env node
/**
 * CLI entry point for WorkflowStateService
 *
 * Usage:
 *   node update-workflow-state.js setActiveStep <step>
 *   node update-workflow-state.js setTddPhase <phase>
 *   node update-workflow-state.js completeStep <step>
 *   node update-workflow-state.js setSupervisor <status>
 *   node update-workflow-state.js setProgress '<json>'
 *   node update-workflow-state.js resetTddCycle
 *   node update-workflow-state.js workflowComplete
 *   node update-workflow-state.js reset
 */

import * as fs from 'fs';
import * as path from 'path';
import { WorkflowStateService, ChainStep, SupervisorStatus } from '../services/workflow-state.js';

/**
 * Validate project path for security (prevent path traversal attacks)
 * - Must be an absolute path
 * - Must exist and be a directory
 * - Must be within $HOME or user's temp directory (reasonable for developer tools)
 * - Must not contain path traversal sequences after resolution
 */
function validateProjectPath(projectPath: string): string | null {
  try {
    const home = process.env.HOME || '';
    if (!home) {
      return null;
    }

    // Reject empty or non-absolute paths
    if (!projectPath || !path.isAbsolute(projectPath)) {
      return null;
    }

    // Resolve symlinks and normalize path
    const canonical = fs.realpathSync(projectPath);

    // Must be a directory
    const stats = fs.statSync(canonical);
    if (!stats.isDirectory()) {
      return null;
    }

    // Security: Must be within $HOME or user's temp directory
    // This allows both production use ($HOME) and test use (TMPDIR, /tmp, /var/folders)
    const homeResolved = fs.realpathSync(home);
    const isInHome = canonical.startsWith(homeResolved + path.sep) || canonical === homeResolved;

    // Also allow user-specific temp directories (for tests)
    const tmpDir = process.env.TMPDIR || '/tmp';
    let isInTmp = false;
    try {
      const tmpResolved = fs.realpathSync(tmpDir);
      isInTmp = canonical.startsWith(tmpResolved + path.sep) || canonical === tmpResolved;
    } catch {
      // TMPDIR might not exist or be accessible
    }

    // Also allow /private/tmp and /private/var/folders (macOS temp locations)
    const isInPrivateTmp = canonical.startsWith('/private/tmp/') || canonical.startsWith('/private/var/folders/');

    if (!isInHome && !isInTmp && !isInPrivateTmp) {
      console.error(`Security: Path outside allowed directories rejected: ${canonical}`);
      return null;
    }

    return canonical;
  } catch {
    // Path doesn't exist, permission denied, or symlink resolution failed
    return null;
  }
}

// Parse --project-dir flag to determine state file location
function getStateFilePath(args: string[]): { stateFilePath: string | undefined; remainingArgs: string[] } {
  const projectDirIndex = args.indexOf('--project-dir');

  if (projectDirIndex !== -1 && args[projectDirIndex + 1]) {
    const projectDir = args[projectDirIndex + 1];
    const validatedPath = validateProjectPath(projectDir);
    if (validatedPath) {
      const stateFilePath = path.join(validatedPath, '.oss', 'workflow-state.json');
      // Remove flag from args
      const remainingArgs = [...args];
      remainingArgs.splice(projectDirIndex, 2);
      return { stateFilePath, remainingArgs };
    }
    // Invalid path - fall through to default
    const remainingArgs = [...args];
    remainingArgs.splice(projectDirIndex, 2);
    return { stateFilePath: undefined, remainingArgs };
  }

  // If no --project-dir, check current-project file
  const currentProjectPath = path.join(process.env.HOME || '', '.oss', 'current-project');
  try {
    const projectDir = fs.readFileSync(currentProjectPath, 'utf-8').trim();
    const validatedPath = validateProjectPath(projectDir);
    if (validatedPath) {
      return {
        stateFilePath: path.join(validatedPath, '.oss', 'workflow-state.json'),
        remainingArgs: args,
      };
    }
  } catch {
    // No current-project file or invalid, use default
  }

  return { stateFilePath: undefined, remainingArgs: args };
}

const { stateFilePath, remainingArgs } = getStateFilePath(process.argv.slice(2));
const service = new WorkflowStateService(stateFilePath);

async function main() {
  const args = remainingArgs;

  if (args.length < 1) {
    console.error('Usage: update-workflow-state <command> [args]');
    process.exit(1);
  }

  const command = args[0];

  try {
    switch (command) {
      case 'setActiveStep': {
        const step = args[1] as ChainStep;
        await service.setActiveStep(step);
        console.log(`Active step set to: ${step}`);
        break;
      }

      case 'setTddPhase': {
        const phase = args[1] as ChainStep;
        await service.setTddPhase(phase);
        console.log(`TDD phase set to: ${phase}`);
        break;
      }

      case 'completeStep': {
        const step = args[1] as ChainStep;
        await service.completeStep(step);
        console.log(`Step completed: ${step}`);
        break;
      }

      case 'setSupervisor': {
        const status = args[1] as SupervisorStatus;
        await service.setSupervisor(status);
        console.log(`Supervisor status set to: ${status}`);
        break;
      }

      case 'setProgress': {
        const progressJson = args[1] || '{}';
        const progress = JSON.parse(progressJson);
        await service.setProgress(progress);
        console.log('Progress updated');
        break;
      }

      case 'resetTddCycle': {
        await service.resetTddCycle();
        console.log('TDD cycle reset - starting new iteration');
        break;
      }

      case 'workflowComplete': {
        await service.workflowComplete();
        console.log('Workflow marked complete');
        break;
      }

      case 'reset': {
        await service.reset();
        console.log('State reset');
        break;
      }

      case 'init': {
        await service.initialize();
        console.log('State initialized');
        break;
      }

      case 'setActiveAgent': {
        const agentJson = args[1] || '{}';
        const agent = JSON.parse(agentJson);
        await service.setActiveAgent(agent);
        console.log(`Active agent set: ${agent.type}`);
        break;
      }

      case 'clearActiveAgent': {
        await service.clearActiveAgent();
        console.log('Active agent cleared');
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }
}

main();
