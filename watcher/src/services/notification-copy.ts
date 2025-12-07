/**
 * NotificationCopyService - World-class notification copy generation
 *
 * @behavior Generates branded, contextual notification messages
 * @acceptance-criteria AC-COPY.1 through AC-COPY.28
 */

// =============================================================================
// Types
// =============================================================================

export type SessionEvent = 'context_restored' | 'fresh_session' | 'session_end';

export type WorkflowCommand = 'ideate' | 'plan' | 'build' | 'ship';

export type WorkflowEvent =
  | 'start'
  | 'complete'
  | 'failed'
  | 'task_complete'
  | 'quality_passed'
  | 'pr_created'
  | 'merged';

export type IssueType =
  | 'loop_detected'
  | 'tdd_violation'
  | 'regression'
  | 'phase_stuck'
  | 'chain_broken'
  | 'explicit_failure'
  | 'agent_failed';

export interface Copy {
  title: string;
  message: string;
}

export interface SessionContext {
  branch?: string;
  age?: string;
  project?: string;
  uncommitted?: number;
}

export interface WorkflowContext {
  idea?: string;
  requirementsCount?: number;
  reason?: string;
  taskCount?: number;
  phases?: number;
  totalTasks?: number;
  current?: number;
  total?: number;
  taskName?: string;
  testsPass?: number;
  duration?: string;
  failedTest?: string;
  checks?: string[];
  prNumber?: number;
  prTitle?: string;
  branch?: string;
  blocker?: string;
}

export interface IssueContext {
  toolName?: string;
  iterations?: number;
  violation?: string;
  failedTests?: number;
  previouslyPassing?: boolean;
  phase?: string;
  duration?: string;
  prereq?: string;
  error?: string;
  agent?: string;
}

// =============================================================================
// Templates
// =============================================================================

const SESSION_TEMPLATES: Record<SessionEvent, { title: string; message: string }> = {
  context_restored: {
    title: 'Resumed',
    message: '{branch} • {age}',
  },
  fresh_session: {
    title: 'Ready',
    message: '{project}',
  },
  session_end: {
    title: 'Saved',
    message: '{branch} • {uncommittedText}',
  },
};

const WORKFLOW_TEMPLATES: Record<WorkflowCommand, Record<string, { title: string; message: string }>> = {
  ideate: {
    start: {
      title: 'Ideating',
      message: '"{idea}"',
    },
    complete: {
      title: '→ Plan',
      message: '{requirementsCount} requirements extracted',
    },
    failed: {
      title: 'Ideate Failed',
      message: '{reason}',
    },
  },
  plan: {
    start: {
      title: 'Planning',
      message: 'Designing TDD approach',
    },
    complete: {
      title: '→ Build',
      message: '{taskCount} tasks • {phases} phases',
    },
    failed: {
      title: 'Plan Failed',
      message: 'Check requirements',
    },
  },
  build: {
    start: {
      title: 'Building',
      message: '{totalTasks} tasks',
    },
    task_complete: {
      title: '{current}/{total}',
      message: '{taskName}',
    },
    complete: {
      title: '→ Ship',
      message: '{testsPass} tests • {duration}',
    },
    failed: {
      title: 'Build Failed',
      message: '{failedTest}',
    },
  },
  ship: {
    start: {
      title: 'Shipping',
      message: 'Quality checks',
    },
    quality_passed: {
      title: 'Checks Passed',
      message: '{checksCount} gates',
    },
    pr_created: {
      title: 'PR #{prNumber}',
      message: '{prTitle}',
    },
    merged: {
      title: 'Shipped',
      message: '{branch} → main',
    },
    failed: {
      title: 'Ship Failed',
      message: '{blocker}',
    },
  },
};

const ISSUE_TEMPLATES: Record<IssueType, { title: string; message: string }> = {
  loop_detected: {
    title: 'Loop',
    message: '{toolName} × {iterations}',
  },
  tdd_violation: {
    title: 'TDD Violation',
    message: 'Test first',
  },
  regression: {
    title: 'Regression',
    message: '{failedTests} tests broke',
  },
  phase_stuck: {
    title: 'Stuck',
    message: '{phase} • {duration}',
  },
  chain_broken: {
    title: 'Chain Broken',
    message: 'Run {prereq} first',
  },
  explicit_failure: {
    title: 'Failed',
    message: '{error}',
  },
  agent_failed: {
    title: 'Agent Failed',
    message: '{agent}',
  },
};

// =============================================================================
// Service
// =============================================================================

export class NotificationCopyService {
  /**
   * Get copy for session lifecycle events
   */
  getSessionCopy(event: SessionEvent, context: SessionContext): Copy {
    const template = SESSION_TEMPLATES[event];
    if (!template) {
      return { title: 'OSS', message: 'Session event' };
    }

    let message = template.message;

    // Handle session_end specially for uncommitted count
    if (event === 'session_end') {
      const uncommitted = context.uncommitted ?? 0;
      const uncommittedText = uncommitted === 0 ? 'clean' : `${uncommitted} pending`;
      message = message.replace('{uncommittedText}', uncommittedText);
    }

    message = this.interpolate(message, context as Record<string, unknown>);

    return {
      title: template.title,
      message,
    };
  }

  /**
   * Get copy for workflow command events
   */
  getWorkflowCopy(command: WorkflowCommand, event: WorkflowEvent, context: WorkflowContext): Copy {
    const commandTemplates = WORKFLOW_TEMPLATES[command];
    if (!commandTemplates) {
      return { title: 'OSS', message: 'Workflow event' };
    }

    const template = commandTemplates[event];
    if (!template) {
      return { title: 'OSS', message: 'Workflow event' };
    }

    let message = template.message;
    let title = template.title;

    // Handle special cases
    if (event === 'quality_passed' && context.checks) {
      message = message.replace('{checksCount}', String(context.checks.length));
    }

    title = this.interpolate(title, context as Record<string, unknown>);
    message = this.interpolate(message, context as Record<string, unknown>);

    return {
      title,
      message,
    };
  }

  /**
   * Get copy for issue/intervention events
   */
  getIssueCopy(issueType: IssueType, context: IssueContext): Copy {
    const template = ISSUE_TEMPLATES[issueType];
    if (!template) {
      return { title: 'OSS Issue', message: 'Issue detected' };
    }

    const message = this.interpolate(template.message, context as Record<string, unknown>);

    return {
      title: template.title,
      message,
    };
  }

  /**
   * Get all titles for validation
   */
  getAllTitles(): string[] {
    const titles: string[] = [];

    // Session titles
    for (const template of Object.values(SESSION_TEMPLATES)) {
      titles.push(template.title);
    }

    // Workflow titles
    for (const commandTemplates of Object.values(WORKFLOW_TEMPLATES)) {
      for (const template of Object.values(commandTemplates)) {
        titles.push(template.title);
      }
    }

    // Issue titles
    for (const template of Object.values(ISSUE_TEMPLATES)) {
      titles.push(template.title);
    }

    return [...new Set(titles)]; // Dedupe
  }

  /**
   * Get all messages for validation
   */
  getAllMessages(): string[] {
    const messages: string[] = [];

    // Session messages
    for (const template of Object.values(SESSION_TEMPLATES)) {
      messages.push(template.message);
    }

    // Workflow messages
    for (const commandTemplates of Object.values(WORKFLOW_TEMPLATES)) {
      for (const template of Object.values(commandTemplates)) {
        messages.push(template.message);
      }
    }

    // Issue messages
    for (const template of Object.values(ISSUE_TEMPLATES)) {
      messages.push(template.message);
    }

    return messages;
  }

  /**
   * Interpolate {placeholder} values in a template string
   */
  private interpolate(template: string, context: Record<string, unknown>): string {
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      const value = context[key];
      if (value === undefined || value === null) {
        return match; // Keep placeholder if no value
      }
      return String(value);
    });
  }
}
