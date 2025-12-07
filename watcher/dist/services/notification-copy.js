/**
 * NotificationCopyService - World-class notification copy generation
 *
 * @behavior Generates branded, contextual notification messages
 * @acceptance-criteria AC-COPY.1 through AC-COPY.28
 */
// =============================================================================
// Templates
// =============================================================================
const SESSION_TEMPLATES = {
    context_restored: {
        title: 'Charting Course',
        message: 'Resuming {branch} • {age}',
    },
    fresh_session: {
        title: 'New Voyage',
        message: 'Ready to sail in {project}',
    },
    session_end: {
        title: 'Anchored',
        message: '{branch} • {uncommittedText}',
    },
};
const WORKFLOW_TEMPLATES = {
    ideate: {
        start: {
            title: 'Charting Course',
            message: 'Exploring "{idea}"...',
        },
        complete: {
            title: 'Course Plotted',
            message: '{requirementsCount} requirements mapped. /oss:plan next',
        },
        failed: {
            title: 'Off Course',
            message: 'Navigation issue. Retry?',
        },
    },
    plan: {
        start: {
            title: 'Drawing Maps',
            message: 'Architecting TDD plan...',
        },
        complete: {
            title: 'Maps Ready',
            message: '{taskCount} tasks in {phases} phases',
        },
        failed: {
            title: 'Compass Spinning',
            message: 'Planning blocked. Check reqs',
        },
    },
    build: {
        start: {
            title: 'Raising Sails',
            message: 'Building {totalTasks} tasks...',
        },
        task_complete: {
            title: 'Knot Tied',
            message: '{current}/{total}: {taskName}',
        },
        complete: {
            title: 'Ship Shape',
            message: '{testsPass} tests green in {duration}',
        },
        failed: {
            title: 'Man Overboard',
            message: '{failedTest} needs rescue',
        },
    },
    ship: {
        start: {
            title: 'Final Check',
            message: 'Running quality gates...',
        },
        quality_passed: {
            title: 'All Clear',
            message: '{checksCount} checks passed',
        },
        pr_created: {
            title: 'Ready to Launch',
            message: 'PR #{prNumber}: {prTitle}',
        },
        merged: {
            title: 'Land Ho!',
            message: '{branch} merged to main',
        },
        failed: {
            title: 'Stuck in Port',
            message: '{blocker} blocking',
        },
    },
};
const ISSUE_TEMPLATES = {
    loop_detected: {
        title: 'Caught in Whirlpool',
        message: '{toolName} spinning ({iterations}x)',
    },
    tdd_violation: {
        title: 'Wrong Heading',
        message: 'RED first, then GREEN',
    },
    regression: {
        title: 'Taking on Water',
        message: '{failedTests} tests broke',
    },
    phase_stuck: {
        title: 'Becalmed',
        message: '{phase} stalled {duration}',
    },
    chain_broken: {
        title: 'Lost Bearings',
        message: 'Run {prereq} first',
    },
    explicit_failure: {
        title: 'Rough Seas',
        message: '{error} encountered',
    },
    agent_failed: {
        title: 'Crew Down',
        message: '{agent} needs help',
    },
};
// =============================================================================
// Service
// =============================================================================
export class NotificationCopyService {
    /**
     * Get copy for session lifecycle events
     */
    getSessionCopy(event, context) {
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
        message = this.interpolate(message, context);
        return {
            title: template.title,
            message,
        };
    }
    /**
     * Get copy for workflow command events
     */
    getWorkflowCopy(command, event, context) {
        const commandTemplates = WORKFLOW_TEMPLATES[command];
        if (!commandTemplates) {
            return { title: 'OSS', message: 'Workflow event' };
        }
        const template = commandTemplates[event];
        if (!template) {
            return { title: 'OSS', message: 'Workflow event' };
        }
        let message = template.message;
        // Handle special cases
        if (event === 'quality_passed' && context.checks) {
            message = message.replace('{checksCount}', String(context.checks.length));
        }
        message = this.interpolate(message, context);
        return {
            title: template.title,
            message,
        };
    }
    /**
     * Get copy for issue/intervention events
     */
    getIssueCopy(issueType, context) {
        const template = ISSUE_TEMPLATES[issueType];
        if (!template) {
            return { title: 'OSS Issue', message: 'Issue detected' };
        }
        const message = this.interpolate(template.message, context);
        return {
            title: template.title,
            message,
        };
    }
    /**
     * Get all titles for validation
     */
    getAllTitles() {
        const titles = [];
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
    getAllMessages() {
        const messages = [];
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
    interpolate(template, context) {
        return template.replace(/\{(\w+)\}/g, (match, key) => {
            const value = context[key];
            if (value === undefined || value === null) {
                return match; // Keep placeholder if no value
            }
            return String(value);
        });
    }
}
//# sourceMappingURL=notification-copy.js.map