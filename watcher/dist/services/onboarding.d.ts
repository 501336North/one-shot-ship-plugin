/**
 * Onboarding Service
 *
 * Provides streamlined first-time experience with phased setup.
 * Goal: Time-to-first-value under 2 minutes.
 */
interface OnboardingStep {
    id: string;
    title: string;
    description: string;
    action?: string;
    required: boolean;
}
interface OnboardingPhase {
    name: string;
    description: string;
    estimatedTime: string;
    steps: OnboardingStep[];
}
interface PreflightCheck {
    name: string;
    status: 'pass' | 'fail' | 'warning';
    message: string;
    version?: string;
}
interface HelloWorldDemo {
    title: string;
    description: string;
    steps: {
        title: string;
        command: string;
        output?: string;
    }[];
    requiresAuth: boolean;
}
interface SetupValidation {
    healthy: boolean;
    issues: string[];
    warnings: string[];
}
interface OnboardingOptions {
    configDir?: string;
}
export declare class OnboardingService {
    private configDir;
    private completedSteps;
    constructor(options?: OnboardingOptions);
    /**
     * Get the three onboarding phases
     */
    getPhases(): OnboardingPhase[];
    /**
     * Get completion percentage
     */
    getCompletionPercentage(): number;
    /**
     * Mark a step as completed
     */
    completeStep(stepId: string): void;
    /**
     * Get list of completed steps
     */
    getCompletedSteps(): string[];
    /**
     * Run pre-flight checks
     */
    runPreflightChecks(): Promise<PreflightCheck[]>;
    /**
     * Get the hello world demo
     */
    getHelloWorldDemo(): HelloWorldDemo;
    /**
     * Validate entire setup
     */
    validateSetup(): Promise<SetupValidation>;
    /**
     * Get current phase based on progress
     */
    getCurrentPhase(): number;
    /**
     * Get next step to complete
     */
    getNextStep(): OnboardingStep | null;
}
export {};
//# sourceMappingURL=onboarding.d.ts.map