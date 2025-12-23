/**
 * InterventionGenerator - Creates interventions based on workflow issues
 *
 * Determines response type based on confidence:
 * - High (>0.9): Auto-remediate - take action immediately
 * - Medium (0.7-0.9): Notify + Suggest - alert user with suggested action
 * - Low (<0.7): Notify only - inform user without action
 */

import { WorkflowIssue, IssueType } from '../analyzer/workflow-analyzer.js';

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

// Confidence thresholds
const THRESHOLDS = {
  AUTO_REMEDIATE: 0.9,
  NOTIFY_SUGGEST: 0.7,
};

// Agent mapping for issue types
const ISSUE_TO_AGENT: Partial<Record<IssueType, string>> = {
  loop_detected: 'debugger',
  phase_stuck: 'debugger',
  regression: 'test-engineer',
  out_of_order: 'test-engineer',
  chain_broken: 'debugger',
  tdd_violation: 'test-engineer',
  explicit_failure: 'debugger',
  agent_failed: 'debugger',
  silence: 'debugger',
  missing_milestones: 'test-engineer',
  declining_velocity: 'performance-engineer',
  incomplete_outputs: 'debugger',
  agent_silence: 'debugger',
  abrupt_stop: 'debugger',
  partial_completion: 'debugger',
  abandoned_agent: 'debugger',
  iron_law_violation: 'debugger',
  iron_law_repeated: 'debugger',
  iron_law_ignored: 'debugger',
};

// Human-readable issue type names
const ISSUE_NAMES: Record<IssueType, string> = {
  loop_detected: 'Loop Detected',
  phase_stuck: 'Phase Stuck',
  regression: 'Regression',
  out_of_order: 'Out of Order',
  chain_broken: 'Chain Broken',
  tdd_violation: 'TDD Violation',
  explicit_failure: 'Failure',
  agent_failed: 'Agent Failed',
  silence: 'Workflow Silence',
  missing_milestones: 'Missing Milestones',
  declining_velocity: 'Declining Velocity',
  incomplete_outputs: 'Incomplete Outputs',
  agent_silence: 'Agent Silence',
  abrupt_stop: 'Abrupt Stop',
  partial_completion: 'Partial Completion',
  abandoned_agent: 'Abandoned Agent',
  iron_law_violation: 'IRON LAW Violation',
  iron_law_repeated: 'IRON LAW Repeated Violation',
  iron_law_ignored: 'IRON LAW Violation Ignored',
};

export class InterventionGenerator {
  /**
   * Generate an intervention for a workflow issue
   */
  generate(issue: WorkflowIssue): Intervention {
    const responseType = this.determineResponseType(issue.confidence);
    const notification = this.createNotification(issue);

    const intervention: Intervention = {
      response_type: responseType,
      issue,
      notification,
    };

    // Add queue task for auto_remediate and notify_suggest
    if (responseType === 'auto_remediate' || responseType === 'notify_suggest') {
      intervention.queue_task = this.createQueueTask(issue, responseType);
    }

    return intervention;
  }

  /**
   * Create a prompt describing the issue for Claude
   */
  createPrompt(issue: WorkflowIssue): string {
    const sections: string[] = [];

    // Header
    sections.push(`## Workflow Issue: ${ISSUE_NAMES[issue.type]}\n`);

    // Description
    sections.push(`### Issue Description\n${issue.message}\n`);

    // Evidence from context
    if (issue.context && Object.keys(issue.context).length > 0) {
      sections.push('### Evidence\n');
      for (const [key, value] of Object.entries(issue.context)) {
        const formattedValue = this.formatContextValue(key, value);
        sections.push(`- **${this.formatKey(key)}**: ${formattedValue}`);
      }
      sections.push('');
    }

    // Suggested action
    sections.push(`### Suggested Action\n${this.getSuggestedAction(issue)}\n`);

    // Confidence
    sections.push(`### Confidence\n${(issue.confidence * 100).toFixed(0)}%\n`);

    return sections.join('\n');
  }

  /**
   * Create a notification for the status line
   */
  createNotification(issue: WorkflowIssue): Notification {
    const title = `OSS: ${ISSUE_NAMES[issue.type]}`;
    let message = issue.message;

    // For repeated violations, ensure "repeated" is in the message
    if (issue.type === 'iron_law_repeated' && !message.toLowerCase().includes('repeated')) {
      message = message.replace(/violated/, 'repeatedly violated');
    }

    const sound = this.getSoundForConfidence(issue.confidence);

    return { title, message, sound };
  }

  private determineResponseType(confidence: number): ResponseType {
    if (confidence > THRESHOLDS.AUTO_REMEDIATE) {
      return 'auto_remediate';
    } else if (confidence >= THRESHOLDS.NOTIFY_SUGGEST) {
      return 'notify_suggest';
    } else {
      return 'notify_only';
    }
  }

  private createQueueTask(issue: WorkflowIssue, responseType: ResponseType): QueueTask {
    const agentType = this.getAgentForIssue(issue);
    const prompt = this.createPrompt(issue);
    const isAutoExecute = responseType === 'auto_remediate';

    return {
      priority: isAutoExecute ? 'high' : 'medium',
      auto_execute: isAutoExecute,
      prompt,
      agent_type: agentType,
    };
  }

  private getAgentForIssue(issue: WorkflowIssue): string {
    // Check if context specifies an agent type
    if (issue.context?.agent_type) {
      return String(issue.context.agent_type);
    }

    // Default mapping
    return ISSUE_TO_AGENT[issue.type] || 'debugger';
  }

  private getSuggestedAction(issue: WorkflowIssue): string {
    switch (issue.type) {
      case 'loop_detected':
        return 'Break out of the loop by trying a different approach. Analyze what action is being repeated and why it is not succeeding.';

      case 'phase_stuck':
        return 'Investigate why the phase is not completing. Check for blocking errors, infinite loops, or missing dependencies.';

      case 'regression':
        return 'Revert the recent changes or fix the broken tests. Ensure GREEN phase passes before proceeding to REFACTOR.';

      case 'out_of_order':
        return 'Follow the correct TDD phase order: RED (write failing test) -> GREEN (make test pass) -> REFACTOR (clean up).';

      case 'chain_broken':
        return 'Complete the prerequisite command before proceeding. The workflow chain should follow: ideate -> plan -> build -> ship.';

      case 'tdd_violation':
        return 'Write failing tests first (RED phase) before implementing code (GREEN phase). This is fundamental to TDD.';

      case 'explicit_failure':
        return 'Investigate and fix the error that caused the failure. Check logs and error messages for root cause.';

      case 'agent_failed':
        return 'Review what caused the agent to fail. Consider retrying or using a different approach.';

      case 'silence':
        return 'Check if the workflow is still running. Consider if it is waiting for user input or has stalled.';

      case 'missing_milestones':
        return 'Ensure each phase produces expected outputs and checkpoints. Log milestones as work progresses.';

      case 'declining_velocity':
        return 'Workflow is slowing down. Consider if complexity is increasing or if there are blocking issues.';

      case 'incomplete_outputs':
        return 'Ensure the command produces expected outputs before marking complete. Check for missing files or artifacts.';

      case 'agent_silence':
        return 'Check if the spawned agent started correctly. Consider restarting or using a different agent.';

      case 'abrupt_stop':
        return 'Workflow stopped unexpectedly after making progress. Check for crashes, timeouts, or user interruption.';

      case 'partial_completion':
        return 'Some phases completed but workflow did not finish. Resume from the stuck phase or investigate the blocker.';

      case 'abandoned_agent':
        return 'An agent started but never completed. Check for timeouts, errors, or stuck processes.';

      case 'iron_law_violation':
        return 'IRON LAW violated. Delete code written without test and start with failing test first.';

      case 'iron_law_repeated':
        return 'IRON LAW repeatedly violated. Fetch IRON LAWS from API and place at top of context. Follow TDD strictly.';

      case 'iron_law_ignored':
        return 'IRON LAW violation not addressed. Stop current work and fix the violation immediately.';

      default:
        return 'Investigate the issue and take appropriate corrective action.';
    }
  }

  private getSoundForConfidence(confidence: number): string {
    if (confidence > THRESHOLDS.AUTO_REMEDIATE) {
      return 'Basso'; // Alert sound for critical
    } else if (confidence >= THRESHOLDS.NOTIFY_SUGGEST) {
      return 'Purr'; // Gentle sound for warning
    } else {
      return 'Pop'; // Quiet sound for info
    }
  }

  private formatKey(key: string): string {
    return key
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private formatContextValue(key: string, value: unknown): string {
    if (key.endsWith('_ms') && typeof value === 'number') {
      // Format milliseconds as human-readable time
      const seconds = Math.round(value / 1000);
      if (seconds >= 60) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return remainingSeconds > 0 ? `${minutes} minutes ${remainingSeconds} seconds` : `${minutes} minutes`;
      }
      return `${seconds} seconds`;
    }

    if (Array.isArray(value)) {
      return value.join(', ');
    }

    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value);
    }

    return String(value);
  }
}
