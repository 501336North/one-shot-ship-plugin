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
 *   node update-workflow-state.js setNotification <message> [ttlSeconds]
 *   node update-workflow-state.js clearNotification
 *   node update-workflow-state.js clearProgress
 *   node update-workflow-state.js prepareForNewSession
 *   node update-workflow-state.js setSessionId <sessionId>
 *   node update-workflow-state.js setLastCommand <command>
 *   node update-workflow-state.js clearLastCommand
 *   node update-workflow-state.js setWorkflowComplete <true|false>
 */
import * as fs from 'fs';
import * as path from 'path';
import { WorkflowStateService } from '../services/workflow-state.js';
import { resolveProjectDir } from '../utils/project-dir.js';
/**
 * Validate project path for security (prevent path traversal attacks)
 * - Must be an absolute path
 * - Must exist and be a directory
 * - Must be within $HOME or user's temp directory (reasonable for developer tools)
 * - Must not contain path traversal sequences after resolution
 */
function validateProjectPath(projectPath) {
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
        }
        catch {
            // TMPDIR might not exist or be accessible
        }
        // Also allow /private/tmp and /private/var/folders (macOS temp locations)
        const isInPrivateTmp = canonical.startsWith('/private/tmp/') || canonical.startsWith('/private/var/folders/');
        if (!isInHome && !isInTmp && !isInPrivateTmp) {
            console.error(`Security: Path outside allowed directories rejected: ${canonical}`);
            return null;
        }
        return canonical;
    }
    catch {
        // Path doesn't exist, permission denied, or symlink resolution failed
        return null;
    }
}
// Parse --project-dir flag to determine state file location
function getStateFilePath(args) {
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
    // The shared rule (utils/project-dir.ts): CLAUDE_PROJECT_DIR, else the cwd's nearest real .oss
    const projectDir = resolveProjectDir(process.env);
    const validatedPath = projectDir === null ? null : validateProjectPath(projectDir);
    if (validatedPath) {
        return {
            stateFilePath: path.join(validatedPath, '.oss', 'workflow-state.json'),
            remainingArgs: args,
        };
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
    // F10: hold the success line until we know the write was not refused
    const said = [];
    const say = (line) => {
        said.push(line);
    };
    try {
        switch (command) {
            case 'setActiveStep': {
                const step = args[1];
                await service.setActiveStep(step);
                say(`Active step set to: ${step}`);
                break;
            }
            case 'setTddPhase': {
                const phase = args[1];
                await service.setTddPhase(phase);
                say(`TDD phase set to: ${phase}`);
                break;
            }
            case 'clearTddPhase': {
                await service.clearTddPhase();
                say('TDD phase cleared');
                break;
            }
            case 'completeStep': {
                const step = args[1];
                await service.completeStep(step);
                say(`Step completed: ${step}`);
                break;
            }
            case 'setSupervisor': {
                const status = args[1];
                await service.setSupervisor(status);
                say(`Supervisor status set to: ${status}`);
                break;
            }
            case 'setProgress': {
                const progressJson = args[1] || '{}';
                const progress = JSON.parse(progressJson);
                await service.setProgress(progress);
                say('Progress updated');
                break;
            }
            case 'resetTddCycle': {
                await service.resetTddCycle();
                say('TDD cycle reset - starting new iteration');
                break;
            }
            case 'workflowComplete': {
                await service.workflowComplete();
                say('Workflow marked complete');
                break;
            }
            case 'reset': {
                await service.reset();
                say('State reset');
                break;
            }
            case 'init': {
                await service.initialize();
                say('State initialized');
                break;
            }
            case 'setActiveAgent': {
                const agentJson = args[1] || '{}';
                const agent = JSON.parse(agentJson);
                await service.setActiveAgent(agent);
                say(`Active agent set: ${agent.type}`);
                break;
            }
            case 'clearActiveAgent': {
                await service.clearActiveAgent();
                say('Active agent cleared');
                break;
            }
            case 'setMessage': {
                const message = args[1] || '';
                await service.setMessage(message);
                say(`Message set: ${message}`);
                break;
            }
            case 'clearMessage': {
                await service.clearMessage();
                say('Message cleared');
                break;
            }
            case 'setCurrentCommand': {
                const cmd = args[1] || '';
                await service.setCurrentCommand(cmd);
                say(`Current command set to: ${cmd}`);
                break;
            }
            case 'clearCurrentCommand': {
                await service.clearCurrentCommand();
                say('Current command cleared');
                break;
            }
            case 'setNextCommand': {
                const cmd = args[1] || '';
                await service.setNextCommand(cmd);
                say(`Next command set to: ${cmd}`);
                break;
            }
            case 'clearNextCommand': {
                await service.clearNextCommand();
                say('Next command cleared');
                break;
            }
            case 'setNotification': {
                const message = args[1] || '';
                const ttlSeconds = args[2] ? parseInt(args[2], 10) : 10;
                await service.setNotification(message, ttlSeconds);
                say(`Notification set: ${message} (expires in ${ttlSeconds}s)`);
                break;
            }
            case 'clearNotification': {
                await service.clearNotification();
                say('Notification cleared');
                break;
            }
            case 'clearProgress': {
                await service.clearProgress();
                say('Progress cleared');
                break;
            }
            case 'prepareForNewSession': {
                await service.prepareForNewSession();
                say('Session state prepared');
                break;
            }
            case 'setSessionId': {
                const sessionId = args[1] || '';
                await service.setSessionId(sessionId);
                say(`Session ID set: ${sessionId}`);
                break;
            }
            case 'setLastCommand': {
                const cmd = args[1] || '';
                await service.setLastCommand(cmd);
                say(`Last command set to: ${cmd}`);
                break;
            }
            case 'clearLastCommand': {
                await service.clearLastCommand();
                say('Last command cleared');
                break;
            }
            case 'setWorkflowComplete': {
                const complete = args[1] === 'true';
                await service.setWorkflowComplete(complete);
                say(`Workflow complete set to: ${complete}`);
                break;
            }
            default:
                console.error(`Unknown command: ${command}`);
                process.exit(1);
        }
        if (service.writeRefused) {
            process.exitCode = 1;
            return;
        }
        for (const line of said)
            console.log(line);
    }
    catch (error) {
        console.error(`Error: ${error}`);
        process.exit(1);
    }
}
main();
//# sourceMappingURL=update-workflow-state.js.map