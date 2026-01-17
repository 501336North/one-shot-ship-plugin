/**
 * Build Pre-flight Service
 *
 * Runs pre-flight checks before builds to detect spec drift and
 * ensure spec compliance before proceeding with builds.
 *
 * @behavior BuildPreflightService runs pre-flight checks before builds
 * @acceptance-criteria AC-PREFLIGHT.1 through AC-PREFLIGHT.8
 */
import { SpecMonitor } from '../monitors/spec-monitor.js';
import { SpecReconciler } from './spec-reconciler/reconciler.js';
import { PreflightReport, UserChoice, ChoiceResult } from './spec-reconciler/types.js';
/**
 * BuildPreflightService - Runs pre-flight checks before builds.
 *
 * Checks spec files for drift and coverage, providing options
 * for fixing, proceeding, or updating specs.
 */
export declare class BuildPreflightService {
    private readonly specMonitor;
    private readonly reconciler;
    private readonly basePath;
    constructor(specMonitor: SpecMonitor, reconciler: SpecReconciler, basePath?: string);
    /**
     * Run a pre-flight check for a feature.
     *
     * @param feature - The feature name to check
     * @returns PreflightReport with status, coverage, and drifts
     */
    runPreflightCheck(feature: string): Promise<PreflightReport>;
    /**
     * Handle user's choice for drift resolution.
     *
     * @param choice - The user's choice: 'fix', 'proceed', or 'update'
     * @param report - The pre-flight report containing drift information
     * @returns ChoiceResult indicating success and details
     */
    handleUserChoice(choice: UserChoice, report: PreflightReport): Promise<ChoiceResult>;
    /**
     * Handle 'fix' choice by queuing reconciliation tasks.
     */
    private handleFix;
    /**
     * Handle 'proceed' choice by logging accepted drift.
     */
    private handleProceed;
    /**
     * Handle 'update' choice by modifying the spec file.
     */
    private handleUpdate;
}
//# sourceMappingURL=build-preflight.d.ts.map