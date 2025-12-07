/**
 * NotificationCopyService - World-class notification copy generation
 *
 * @behavior Generates branded, contextual notification messages
 * @acceptance-criteria AC-COPY.1 through AC-COPY.28
 */

// =============================================================================
// Types
// =============================================================================

export type SessionEvent = 'context_restored' | 'fresh_session' | 'fresh_start' | 'session_end' | 'context_saved';

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
  subtitle?: string;
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
  // Chain state for subtitle (full London TDD chain)
  chainState?: {
    ideate?: 'pending' | 'active' | 'done';
    plan?: 'pending' | 'active' | 'done';
    acceptance?: 'pending' | 'active' | 'done';
    red?: 'pending' | 'active' | 'done';
    green?: 'pending' | 'active' | 'done';
    refactor?: 'pending' | 'active' | 'done';
    integration?: 'pending' | 'active' | 'done';
    ship?: 'pending' | 'active' | 'done';
  };
  // TDD phase within build (red/green/refactor)
  tddPhase?: 'red' | 'green' | 'refactor';
  // Supervisor status
  supervisor?: 'watching' | 'intervening' | 'idle';
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
  fresh_start: {
    title: 'Ready',
    message: '{project}',
  },
  session_end: {
    title: 'Saved',
    message: '{branch} • {uncommittedText}',
  },
  context_saved: {
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

    // Handle session_end/context_saved specially for uncommitted count
    if (event === 'session_end' || event === 'context_saved') {
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

    // Generate subtitle showing chain state
    const subtitle = this.generateChainSubtitle(command, event, context);

    return {
      title,
      message,
      subtitle,
    };
  }

  /**
   * Generate subtitle showing full London TDD workflow chain
   * Full chain: ideate → plan → acceptance → red → green → refactor → integration → ship
   * With supervisor indicator: 👁 (watching) or ⚡ (intervening)
   */
  private generateChainSubtitle(
    command: WorkflowCommand,
    event: WorkflowEvent,
    context: WorkflowContext
  ): string {
    // Full London TDD chain
    type ChainStep =
      | 'ideate'
      | 'plan'
      | 'acceptance'
      | 'red'
      | 'green'
      | 'refactor'
      | 'integration'
      | 'ship';
    const fullChain: ChainStep[] = [
      'ideate',
      'plan',
      'acceptance',
      'red',
      'green',
      'refactor',
      'integration',
      'ship',
    ];

    // Derive or use provided chain state
    const state = context.chainState || this.deriveFullChainState(command, event, context.tddPhase);

    const parts = fullChain.map((step) => {
      const stepState = state[step];
      if (stepState === 'done') {
        return `${step}✓`;
      } else if (stepState === 'active') {
        return step.toUpperCase();
      } else {
        return step;
      }
    });

    // Build subtitle with chain
    let subtitle = parts.join(' → ');

    // Add supervisor indicator (robot with status)
    if (context.supervisor === 'watching') {
      subtitle = `🤖✓ ${subtitle}`;
    } else if (context.supervisor === 'intervening') {
      subtitle = `🤖⚡ ${subtitle}`;
    } else if (context.supervisor === 'idle') {
      subtitle = `🤖✗ ${subtitle}`;
    }

    return subtitle;
  }

  /**
   * Derive full chain state from command, event, and TDD phase
   */
  private deriveFullChainState(
    command: WorkflowCommand,
    event: WorkflowEvent,
    tddPhase?: 'red' | 'green' | 'refactor'
  ): NonNullable<WorkflowContext['chainState']> {
    // Map our 4 commands to positions in the full chain
    // ideate=0, plan=1, build spans acceptance(2) through integration(6), ship=7
    const commandToStartIndex: Record<WorkflowCommand, number> = {
      ideate: 0,
      plan: 1,
      build: 2, // acceptance is first step of build
      ship: 7,
    };

    const currentIndex = commandToStartIndex[command];
    const isComplete = event === 'complete' || event === 'merged';

    const state: NonNullable<WorkflowContext['chainState']> = {};

    // For build command, handle the sub-phases
    if (command === 'build') {
      // Everything before build is done
      state.ideate = 'done';
      state.plan = 'done';

      if (isComplete) {
        // Build complete = all build sub-phases done
        state.acceptance = 'done';
        state.red = 'done';
        state.green = 'done';
        state.refactor = 'done';
        state.integration = 'done';
        state.ship = 'pending';
      } else {
        // Determine which build sub-phase is active based on tddPhase
        const tddPhases = ['acceptance', 'red', 'green', 'refactor', 'integration'] as const;
        const activePhaseIndex = tddPhase
          ? tddPhases.indexOf(tddPhase as (typeof tddPhases)[number])
          : 0;

        tddPhases.forEach((phase, i) => {
          if (i < activePhaseIndex) {
            state[phase] = 'done';
          } else if (i === activePhaseIndex) {
            state[phase] = 'active';
          } else {
            state[phase] = 'pending';
          }
        });
        state.ship = 'pending';
      }
    } else {
      // For ideate, plan, ship - simpler logic
      const fullChain = [
        'ideate',
        'plan',
        'acceptance',
        'red',
        'green',
        'refactor',
        'integration',
        'ship',
      ] as const;

      fullChain.forEach((step, i) => {
        if (i < currentIndex) {
          state[step] = 'done';
        } else if (i === currentIndex) {
          state[step] = isComplete ? 'done' : 'active';
        } else if (i <= 6 && currentIndex > 1 && currentIndex < 7) {
          // If we're past plan but before ship, build phases are done
          state[step] = 'done';
        } else {
          state[step] = 'pending';
        }
      });
    }

    return state;
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
