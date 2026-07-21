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
/** Escalation payload delivered to the notification channel (US-005). */
export interface EscalationPayload {
    code: string;
    severity: string;
    message: string;
    recovery: string[];
}
/** Notification collaborator interface (implemented by TelegramNotifier). */
export interface EscalationNotifier {
    sendErrorEscalation(payload: EscalationPayload): Promise<void>;
}
/** Status line collaborator interface (implemented by StatusLineService). */
export interface RetryStatusLine {
    setRetryStatus(text: string): Promise<void>;
}
/** Workflow-log collaborator interface for RECOVERY visibility lines (US-006). */
export interface RecoveryLogger {
    logRecovery(data: Record<string, unknown>): void;
}
/** Optional collaborators — the generator works without them wired. */
export interface InterventionGeneratorOptions {
    notifier?: EscalationNotifier;
    statusLine?: RetryStatusLine;
    recoveryLogger?: RecoveryLogger;
}
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
    private readonly notifier?;
    private readonly statusLine?;
    private readonly recoveryLogger?;
    private readonly registry;
    constructor(options?: InterventionGeneratorOptions);
    /**
     * Generate an intervention for a workflow issue
     */
    generate(issue: WorkflowIssue): Intervention;
    /**
     * Structured OSS_ERROR events follow the retry policy, not the confidence
     * thresholds: cheap + retry_eligible + attempt < MAX_RETRIES → auto-remediate
     * carrying the emitter's retry_hint; everything else escalates (never auto-retry).
     */
    private generateStructuredError;
    /**
     * US-006 retry visibility: every retry task issuance logs a RECOVERY
     * workflow-log line and updates the status line with "⟳ retry N/2: <code>".
     */
    private reportRetryVisibility;
    /**
     * US-005 severity routing: CRITICAL/HIGH escalations notify Telegram with
     * recovery[] steps; MEDIUM/LOW stay in-session/log only. Notification
     * failures are swallowed and logged — never thrown into the pipeline.
     */
    private escalateBySeverity;
    /**
     * Prompt for an auto-remediation retry task (see createStructuredErrorPrompt).
     */
    private createRetryPrompt;
    /**
     * Prompt for a structured OSS_ERROR intervention (retry or escalation).
     *
     * SEC-3: the error-derived code/source/message/retry_hint are UNTRUSTED — they may
     * carry prompt-injection payloads — so they are routed EXCLUSIVELY through a
     * clearly-delimited, explicitly non-authoritative <error_data> block. This method
     * deliberately does NOT append the generic createPrompt() Issue-Description/Evidence
     * dump, which would re-print those same untrusted fields as bare markdown OUTSIDE the
     * guard (unwrapped re-emission bypass). Only static, trusted framing is added around
     * the block.
     *
     * SEC-4: message/retry_hint/source are re-redacted here (defense in depth).
     *
     * @param attempt retry attempt index for the retry path, or `null` for escalation.
     */
    private createStructuredErrorPrompt;
    /**
     * Build the guarded, non-authoritative <error_data> block. Every interpolated
     * untrusted value is redacted (SEC-4) and then delimiter-neutralized (SEC-3) so a
     * payload containing a literal `</error_data>` cannot close the guard early.
     */
    private buildErrorDataBlock;
    /**
     * SEC-3 delimiter-escape defense: replace any literal `<error_data>` /
     * `</error_data>` occurrence (case-insensitive, whitespace-tolerant, e.g.
     * `< / error_data >`) with a safe placeholder so untrusted input can never
     * open or close the guard block.
     */
    private neutralizeErrorDataDelimiters;
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