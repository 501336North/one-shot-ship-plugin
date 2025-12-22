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
        title: 'Context Loaded',
        message: 'Saved {saveDate}',
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
        title: 'Context Persisted',
        message: '{currentDate}',
    },
    context_saved: {
        title: 'Context Persisted',
        message: '{currentDate}',
    },
};
const WORKFLOW_TEMPLATES = {
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
const ISSUE_TEMPLATES = {
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
    getSessionCopy(event, context) {
        const template = SESSION_TEMPLATES[event];
        if (!template) {
            return { title: 'OSS', message: 'Session event' };
        }
        let message = template.message;
        let subtitle;
        // Format uncommitted count text
        const uncommitted = context.uncommitted ?? 0;
        const uncommittedText = uncommitted === 0 ? 'clean' : `${uncommitted} uncommitted`;
        // Handle context_saved/session_end - add current date and subtitle
        if (event === 'session_end' || event === 'context_saved') {
            // Add current date if not provided
            const currentDate = context.currentDate || new Date().toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });
            message = message.replace('{currentDate}', currentDate);
            // Subtitle shows branch and uncommitted count
            subtitle = `[${context.branch || 'unknown'}] • ${uncommittedText}`;
        }
        // Handle context_restored - show save date and subtitle
        if (event === 'context_restored') {
            // Format save date nicely if provided
            // Never show "Saved unknown" - fallback to "Context restored"
            if (context.saveDate && context.saveDate !== 'unknown' && context.saveDate !== '') {
                message = `Saved ${context.saveDate}`;
            }
            else {
                message = 'Context restored';
            }
            // Subtitle shows branch and uncommitted count
            subtitle = `[${context.branch || 'unknown'}] • ${uncommittedText}`;
        }
        message = this.interpolate(message, context);
        return {
            title: template.title,
            message,
            subtitle,
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
        let title = template.title;
        // Handle special cases
        if (event === 'quality_passed' && context.checks) {
            message = message.replace('{checksCount}', String(context.checks.length));
        }
        title = this.interpolate(title, context);
        message = this.interpolate(message, context);
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
    generateChainSubtitle(command, event, context) {
        const fullChain = [
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
            }
            else if (stepState === 'active') {
                return step.toUpperCase();
            }
            else {
                return step;
            }
        });
        // Build subtitle with chain
        let subtitle = parts.join(' → ');
        // Add supervisor indicator (robot with status)
        if (context.supervisor === 'watching') {
            subtitle = `🤖✓ ${subtitle}`;
        }
        else if (context.supervisor === 'intervening') {
            subtitle = `🤖⚡ ${subtitle}`;
        }
        else if (context.supervisor === 'idle') {
            subtitle = `🤖✗ ${subtitle}`;
        }
        return subtitle;
    }
    /**
     * Derive full chain state from command, event, and TDD phase
     */
    deriveFullChainState(command, event, tddPhase) {
        // Map our 4 commands to positions in the full chain
        // ideate=0, plan=1, build spans acceptance(2) through integration(6), ship=7
        const commandToStartIndex = {
            ideate: 0,
            plan: 1,
            build: 2, // acceptance is first step of build
            ship: 7,
        };
        const currentIndex = commandToStartIndex[command];
        const isComplete = event === 'complete' || event === 'merged';
        const state = {};
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
            }
            else {
                // Determine which build sub-phase is active based on tddPhase
                const tddPhases = ['acceptance', 'red', 'green', 'refactor', 'integration'];
                const activePhaseIndex = tddPhase
                    ? tddPhases.indexOf(tddPhase)
                    : 0;
                tddPhases.forEach((phase, i) => {
                    if (i < activePhaseIndex) {
                        state[phase] = 'done';
                    }
                    else if (i === activePhaseIndex) {
                        state[phase] = 'active';
                    }
                    else {
                        state[phase] = 'pending';
                    }
                });
                state.ship = 'pending';
            }
        }
        else {
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
            ];
            fullChain.forEach((step, i) => {
                if (i < currentIndex) {
                    state[step] = 'done';
                }
                else if (i === currentIndex) {
                    state[step] = isComplete ? 'done' : 'active';
                }
                else if (i <= 6 && currentIndex > 1 && currentIndex < 7) {
                    // If we're past plan but before ship, build phases are done
                    state[step] = 'done';
                }
                else {
                    state[step] = 'pending';
                }
            });
        }
        return state;
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