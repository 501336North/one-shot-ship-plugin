/**
 * Spec Reconciler
 *
 * Orchestrates drift reconciliation by classifying drifts as simple or complex,
 * auto-fixing simple cases, and queuing complex cases for manual review.
 *
 * @behavior SpecReconciler classifies drift and orchestrates reconciliation
 * @acceptance-criteria AC-RECONCILER.1 through AC-RECONCILER.12
 */

import { QueueManager } from '../../queue/manager.js';
import { CreateTaskInput } from '../../types.js';
import { DriftResult, ReconciliationEntry, ReconciliationReport } from './types.js';
import { findMatchingFile } from './file-matcher.js';
import { autoFixCheckbox } from './auto-fixer.js';

/**
 * Classify drift as 'simple' (can be auto-fixed) or 'complex' (needs manual review).
 *
 * A drift is classified as 'simple' if:
 * - It's structural_missing and the file actually exists (just unchecked in spec)
 * - Or confidence > 0.9 for structural_extra
 *
 * A drift is classified as 'complex' if:
 * - It's behavioral_mismatch
 * - Or it's structural_missing and file truly doesn't exist
 * - Or it's criteria_incomplete
 * - Or confidence <= 0.9 (uncertainty)
 *
 * @param drift - The drift result to classify
 * @param searchPaths - Directories to search for implementation files
 * @returns 'simple' or 'complex'
 */
export async function classifyDrift(
  drift: DriftResult,
  searchPaths: string[],
): Promise<'simple' | 'complex'> {
  // Behavioral mismatch always requires manual review
  if (drift.type === 'behavioral_mismatch') {
    return 'complex';
  }

  // Criteria incomplete always requires manual review
  if (drift.type === 'criteria_incomplete') {
    return 'complex';
  }

  // Low confidence requires manual review
  if (drift.confidence <= 0.9) {
    return 'complex';
  }

  // For structural_missing with high confidence, check if file actually exists
  // This handles the case where spec is unchecked but file exists
  if (drift.type === 'structural_missing' && drift.specItem) {
    const matchingFile = await findMatchingFile(drift.specItem.id, searchPaths);
    if (matchingFile) {
      // File exists, just need to check the checkbox
      return 'simple';
    }
    // File truly missing, needs manual intervention
    return 'complex';
  }

  // For structural_extra with high confidence, it's simple (just add to spec or remove file)
  if (drift.type === 'structural_extra' && drift.confidence > 0.9) {
    return 'simple';
  }

  return 'complex';
}

/**
 * SpecReconciler - Orchestrates drift reconciliation
 */
export class SpecReconciler {
  private readonly queueManager: QueueManager;

  constructor(queueManager: QueueManager) {
    this.queueManager = queueManager;
  }

  /**
   * Queue a drift task for manual review.
   *
   * @param drift - The drift result to queue
   * @param feature - The feature name for context
   * @param specPath - Path to the spec file
   */
  async queueDriftTask(drift: DriftResult, feature: string, specPath: string): Promise<void> {
    // Determine anomaly type based on drift type
    const anomalyType = drift.type.startsWith('structural_')
      ? 'spec_drift_structural'
      : 'spec_drift_criteria';

    // Determine suggested agent based on drift type
    const suggestedAgent = drift.type.startsWith('structural_') ? 'debugger' : 'code-reviewer';

    // Determine priority based on drift type
    const priority = drift.type.startsWith('structural_') ? 'high' : 'medium';

    // Build the task prompt
    const prompt = this.buildDriftPrompt(drift, feature);

    const task: CreateTaskInput = {
      priority,
      source: 'spec-monitor',
      anomaly_type: anomalyType,
      prompt,
      suggested_agent: suggestedAgent,
      context: {
        drift_type: drift.type,
        spec_item_id: drift.specItem?.id,
        spec_item_description: drift.specItem?.description,
        feature,
        spec_path: specPath,
        confidence: drift.confidence,
        file: drift.filePath,
      },
    };

    await this.queueManager.addTask(task);
  }

  /**
   * Build a descriptive prompt for the drift anomaly.
   */
  private buildDriftPrompt(drift: DriftResult, feature: string): string {
    switch (drift.type) {
      case 'structural_missing':
        return `Spec drift detected in feature "${feature}": ${drift.description}. Either implement the component or update the spec.`;
      case 'structural_extra':
        return `Spec drift detected in feature "${feature}": ${drift.description}. Either add this component to the spec or determine if it should be removed.`;
      case 'criteria_incomplete':
        return `Spec drift detected in feature "${feature}": ${drift.description}. Add test coverage for this criterion or mark it as complete in the spec.`;
      default:
        return `Spec drift detected in feature "${feature}": ${drift.description}.`;
    }
  }

  /**
   * Reconcile a list of drifts for a feature.
   *
   * For each drift:
   * - Classify as simple or complex
   * - If simple: auto-fix
   * - If complex: queue task
   * - Log result
   *
   * @param drifts - List of drift results to reconcile
   * @param feature - The feature name
   * @param specPath - Path to the spec file
   * @param searchPaths - Directories to search for implementation files
   * @returns Reconciliation report
   */
  async reconcile(
    drifts: DriftResult[],
    feature: string,
    specPath: string,
    searchPaths: string[],
  ): Promise<ReconciliationReport> {
    const entries: ReconciliationEntry[] = [];
    let fixed = 0;
    let queued = 0;
    let failed = 0;

    for (const drift of drifts) {
      const classification = await classifyDrift(drift, searchPaths);
      const timestamp = new Date().toISOString();

      if (classification === 'simple') {
        // Attempt auto-fix
        const fixResult = await this.attemptAutoFix(drift, specPath);

        if (fixResult.success) {
          fixed++;
          entries.push({
            timestamp,
            feature,
            drift_type: drift.type,
            action: 'auto_fixed',
            details: fixResult.details || `Auto-fixed ${drift.type}`,
          });
        } else {
          // Auto-fix failed, fall back to queuing
          await this.queueDriftTask(drift, feature, specPath);
          queued++;
          entries.push({
            timestamp,
            feature,
            drift_type: drift.type,
            action: 'queued',
            details: `Auto-fix failed: ${fixResult.reason}. Queued for manual review.`,
          });
        }
      } else {
        // Complex drift, queue for manual review
        try {
          await this.queueDriftTask(drift, feature, specPath);
          queued++;
          entries.push({
            timestamp,
            feature,
            drift_type: drift.type,
            action: 'queued',
            details: `Queued for manual review: ${drift.description}`,
          });
        } catch (error) {
          failed++;
          entries.push({
            timestamp,
            feature,
            drift_type: drift.type,
            action: 'failed',
            details: `Failed to queue task: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    }

    return {
      feature,
      fixed,
      queued,
      failed,
      entries,
    };
  }

  /**
   * Attempt to auto-fix a simple drift.
   *
   * @param drift - The drift to fix
   * @param specPath - Path to the spec file
   * @returns Result of the auto-fix attempt
   */
  private async attemptAutoFix(
    drift: DriftResult,
    specPath: string,
  ): Promise<{ success: boolean; details?: string; reason?: string }> {
    // Currently only support checkbox auto-fixing
    if (drift.type === 'structural_missing' && drift.specItem) {
      return await autoFixCheckbox(specPath, drift.specItem.id);
    }

    // Other auto-fix types not yet implemented
    return {
      success: false,
      reason: `Auto-fix not supported for drift type: ${drift.type}`,
    };
  }
}
