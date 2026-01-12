/**
 * Tutorial Service
 *
 * Interactive onboarding for new OSS Dev Workflow users.
 * Goal: Make users productive within 10 minutes.
 */
export interface Exercise {
    instruction: string;
    expectedOutcome: string;
    command?: string;
}
export interface Lesson {
    id: string;
    title: string;
    description: string;
    exercises: Exercise[];
    estimatedMinutes: number;
}
export declare class TutorialService {
    private completedLessons;
    private progressFile;
    constructor();
    /**
     * Get all available lessons in order
     */
    getAllLessons(): Lesson[];
    /**
     * Get the IDs of completed lessons
     */
    getCompletedLessons(): string[];
    /**
     * Mark a lesson as completed
     */
    completeLesson(lessonId: string): void;
    /**
     * Calculate progress percentage (0-100)
     */
    getProgressPercentage(): number;
    /**
     * Get the next uncompleted lesson
     */
    getNextLesson(): Lesson | null;
    /**
     * Get a specific lesson by ID
     */
    getLesson(lessonId: string): Lesson | undefined;
    /**
     * Save progress to disk
     */
    saveProgress(): void;
    /**
     * Load progress from disk
     */
    loadProgress(): void;
    /**
     * Reset all progress
     */
    resetProgress(): void;
    /**
     * Get estimated time to complete remaining lessons
     */
    getEstimatedRemainingTime(): number;
    /**
     * Check if tutorial is complete
     */
    isComplete(): boolean;
}
//# sourceMappingURL=tutorial.d.ts.map