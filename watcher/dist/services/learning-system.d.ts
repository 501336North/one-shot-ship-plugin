/**
 * Learning System Service
 *
 * Provides interactive tutorials, concept explanations, and skill progression
 * to help users learn OSS workflows progressively.
 */
export declare enum SkillLevel {
    BEGINNER = "beginner",
    INTERMEDIATE = "intermediate",
    ADVANCED = "advanced",
    EXPERT = "expert"
}
interface TutorialStep {
    title: string;
    content: string;
    command?: string;
    expectedOutput?: string;
}
interface Tutorial {
    id: string;
    title: string;
    description: string;
    difficulty: SkillLevel;
    steps: TutorialStep[];
    estimatedTime: string;
}
interface Concept {
    id: string;
    title: string;
    summary: string;
    details: string;
    examples: string[];
    relatedCommands: string[];
    relatedConcepts: string[];
}
interface Recommendation {
    type: 'tutorial' | 'concept';
    id: string;
    reason: string;
}
interface SkillTreeLevel {
    unlocked: boolean;
    skills: string[];
    requirements: string[];
}
interface SkillTree {
    beginner: SkillTreeLevel;
    intermediate: SkillTreeLevel;
    advanced: SkillTreeLevel;
    expert: SkillTreeLevel;
}
interface QuickstartGuide {
    title: string;
    description: string;
    steps: TutorialStep[];
    estimatedTime: string;
}
interface Progress {
    completedTutorials: string[];
    viewedConcepts: string[];
    skillLevel: SkillLevel;
}
export declare class LearningSystem {
    private tutorials;
    private concepts;
    private progress;
    private quickstartStep;
    constructor();
    private initializeTutorials;
    private initializeConcepts;
    /**
     * List all available tutorials
     */
    listTutorials(): Tutorial[];
    /**
     * Get tutorial by ID
     */
    getTutorial(id: string): Tutorial | undefined;
    /**
     * Explain a concept
     */
    explainConcept(id: string): Concept | undefined;
    /**
     * List all concept IDs
     */
    listConcepts(): string[];
    /**
     * Get current skill level
     */
    getSkillLevel(): SkillLevel;
    /**
     * Set skill level
     */
    setSkillLevel(level: SkillLevel): void;
    /**
     * Get learning recommendations based on skill level
     */
    getRecommendations(): Recommendation[];
    /**
     * Mark tutorial as completed
     */
    completeTutorial(id: string): void;
    /**
     * Get current progress
     */
    getProgress(): Progress;
    /**
     * Get skill tree
     */
    getSkillTree(): SkillTree;
    /**
     * Get quickstart guide
     */
    getQuickstartGuide(): QuickstartGuide;
    /**
     * Get current quickstart step
     */
    getQuickstartStep(): number;
    /**
     * Advance to next quickstart step
     */
    advanceQuickstart(): void;
}
export {};
//# sourceMappingURL=learning-system.d.ts.map