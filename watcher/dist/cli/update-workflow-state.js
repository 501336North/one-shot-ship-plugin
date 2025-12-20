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
import { WorkflowStateService } from '../services/workflow-state.js';
const service = new WorkflowStateService();
async function main() {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.error('Usage: update-workflow-state <command> [args]');
        process.exit(1);
    }
    const command = args[0];
    try {
        switch (command) {
            case 'setActiveStep': {
                const step = args[1];
                await service.setActiveStep(step);
                console.log(`Active step set to: ${step}`);
                break;
            }
            case 'setTddPhase': {
                const phase = args[1];
                await service.setTddPhase(phase);
                console.log(`TDD phase set to: ${phase}`);
                break;
            }
            case 'completeStep': {
                const step = args[1];
                await service.completeStep(step);
                console.log(`Step completed: ${step}`);
                break;
            }
            case 'setSupervisor': {
                const status = args[1];
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
            default:
                console.error(`Unknown command: ${command}`);
                process.exit(1);
        }
    }
    catch (error) {
        console.error(`Error: ${error}`);
        process.exit(1);
    }
}
main();
//# sourceMappingURL=update-workflow-state.js.map