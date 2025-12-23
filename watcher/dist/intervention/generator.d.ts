/**
 * InterventionGenerator - Creates interventions based on workflow issues
 *
 * Determines response type based on confidence:
 * - High (>0.9): Auto-remediate - take action immediately
 * - Medium (0.7-0.9): Notify + Suggest - alert user with suggested action
 * - Low (<0.7): Notify only - inform user without action
 */
import { WorkflowIssue } from '../analyzer/workflow-analyzer.js';
export type ResponseType = 'auto_remediate' | 'notify_suggest' | 'notify_only';
export interface QueueTask {
    priority: 'high' | 'medium' | 'low';
    auto_execute: boolean;
    prompt: string;
    agent_type?: string;
}
export interface Notification {
    title: string;
    message: string;
    sound?: string;
}
export interface Intervention {
    response_type: ResponseType;
    issue: WorkflowIssue;
    queue_task?: QueueTask;
    notification: Notification;
}
export declare class InterventionGenerator {
    /**
     * Generate an intervention for a workflow issue
     */
    generate(issue: WorkflowIssue): Intervention;
    /**
     * Create a prompt describing the issue for Claude
     */
    createPrompt(issue: WorkflowIssue): string;
    /**
     * Create a notification for the status line
     */
    createNotification(issue: WorkflowIssue): Notification;
    private determineResponseType;
    private createQueueTask;
    private getAgentForIssue;
    private getSuggestedAction;
    private getSoundForConfidence;
    private formatKey;
    private formatContextValue;
}
//# sourceMappingURL=generator.d.ts.map