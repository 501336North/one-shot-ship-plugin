/**
 * Tutorial Service
 *
 * Interactive onboarding for new OSS Dev Workflow users.
 * Goal: Make users productive within 10 minutes.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
const LESSONS = [
    {
        id: 'intro',
        title: 'Welcome to OSS Dev Workflow',
        description: 'Learn what OSS is and how it transforms your development process.',
        estimatedMinutes: 2,
        exercises: [
            {
                instruction: 'Run /oss:status to check your subscription status',
                expectedOutcome: 'You should see your subscription tier and usage info',
                command: '/oss:status',
            },
            {
                instruction: 'Run /oss:legend to see the status line symbols',
                expectedOutcome: 'You should see the meaning of each status icon',
                command: '/oss:legend',
            },
        ],
    },
    {
        id: 'tdd-basics',
        title: 'Test-Driven Development Basics',
        description: 'Understand the RED-GREEN-REFACTOR cycle that powers OSS.',
        estimatedMinutes: 5,
        exercises: [
            {
                instruction: 'Read about TDD in your project CLAUDE.md file',
                expectedOutcome: 'Understand the IRON LAWS around TDD',
            },
            {
                instruction: 'Observe the status line when running /oss:red',
                expectedOutcome: 'See the 🔴 RED phase indicator',
                command: '/oss:red',
            },
            {
                instruction: 'Observe the status line when running /oss:green',
                expectedOutcome: 'See the 🟢 GREEN phase indicator',
                command: '/oss:green',
            },
        ],
    },
    {
        id: 'workflow-chain',
        title: 'The Workflow Chain',
        description: 'Learn the ideate → plan → build → ship workflow.',
        estimatedMinutes: 5,
        exercises: [
            {
                instruction: 'Use /oss:ideate to brainstorm a simple feature idea',
                expectedOutcome: 'Claude helps you refine your idea into requirements',
                command: '/oss:ideate',
            },
            {
                instruction: 'Use /oss:plan to create a TDD implementation plan',
                expectedOutcome: 'A phased plan with test-first tasks is created',
                command: '/oss:plan',
            },
            {
                instruction: 'Observe how the status line shows workflow progress',
                expectedOutcome: 'See progress like "3/10 tasks" and next steps',
            },
        ],
    },
    {
        id: 'agent-delegation',
        title: 'Agent Specialization',
        description: 'Understand how OSS delegates to specialized agents.',
        estimatedMinutes: 3,
        exercises: [
            {
                instruction: 'Look at the agent list in your CLAUDE.md file',
                expectedOutcome: 'See the specialized agents available (typescript-pro, security-auditor, etc.)',
            },
            {
                instruction: 'Notice how /oss:ship uses parallel agents for quality checks',
                expectedOutcome: 'Understand code-reviewer, security-auditor, and performance-auditor work in parallel',
            },
        ],
    },
    {
        id: 'quality-gates',
        title: 'Quality Gates',
        description: 'Learn about the quality checks that ensure code excellence.',
        estimatedMinutes: 2,
        exercises: [
            {
                instruction: 'Run /oss:review on some code you want to improve',
                expectedOutcome: 'Receive multi-perspective feedback on your code',
                command: '/oss:review',
            },
            {
                instruction: 'Observe how /oss:ship runs quality gates before creating PR',
                expectedOutcome: 'See tests, build, and security checks run automatically',
            },
        ],
    },
];
export class TutorialService {
    completedLessons = [];
    progressFile;
    constructor() {
        const ossDir = path.join(os.homedir(), '.oss');
        this.progressFile = path.join(ossDir, 'tutorial-progress.json');
    }
    /**
     * Get all available lessons in order
     */
    getAllLessons() {
        return [...LESSONS];
    }
    /**
     * Get the IDs of completed lessons
     */
    getCompletedLessons() {
        return [...this.completedLessons];
    }
    /**
     * Mark a lesson as completed
     */
    completeLesson(lessonId) {
        if (!this.completedLessons.includes(lessonId)) {
            this.completedLessons.push(lessonId);
        }
    }
    /**
     * Calculate progress percentage (0-100)
     */
    getProgressPercentage() {
        if (LESSONS.length === 0)
            return 0;
        return Math.round((this.completedLessons.length / LESSONS.length) * 100);
    }
    /**
     * Get the next uncompleted lesson
     */
    getNextLesson() {
        for (const lesson of LESSONS) {
            if (!this.completedLessons.includes(lesson.id)) {
                return lesson;
            }
        }
        return null; // All lessons completed
    }
    /**
     * Get a specific lesson by ID
     */
    getLesson(lessonId) {
        return LESSONS.find(l => l.id === lessonId);
    }
    /**
     * Save progress to disk
     */
    saveProgress() {
        const ossDir = path.dirname(this.progressFile);
        if (!fs.existsSync(ossDir)) {
            fs.mkdirSync(ossDir, { recursive: true });
        }
        const data = {
            completedLessons: this.completedLessons,
            lastUpdated: new Date().toISOString(),
        };
        fs.writeFileSync(this.progressFile, JSON.stringify(data, null, 2));
    }
    /**
     * Load progress from disk
     */
    loadProgress() {
        try {
            if (fs.existsSync(this.progressFile)) {
                const content = fs.readFileSync(this.progressFile, 'utf-8');
                const data = JSON.parse(content);
                this.completedLessons = data.completedLessons || [];
            }
        }
        catch {
            // If file is corrupt, start fresh
            this.completedLessons = [];
        }
    }
    /**
     * Reset all progress
     */
    resetProgress() {
        this.completedLessons = [];
        if (fs.existsSync(this.progressFile)) {
            fs.unlinkSync(this.progressFile);
        }
    }
    /**
     * Get estimated time to complete remaining lessons
     */
    getEstimatedRemainingTime() {
        let total = 0;
        for (const lesson of LESSONS) {
            if (!this.completedLessons.includes(lesson.id)) {
                total += lesson.estimatedMinutes;
            }
        }
        return total;
    }
    /**
     * Check if tutorial is complete
     */
    isComplete() {
        return this.completedLessons.length === LESSONS.length;
    }
}
//# sourceMappingURL=tutorial.js.map