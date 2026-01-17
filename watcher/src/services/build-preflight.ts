/**
 * Build Pre-flight Service
 *
 * Runs pre-flight checks before builds to detect spec drift and
 * ensure spec compliance before proceeding with builds.
 *
 * @behavior BuildPreflightService runs pre-flight checks before builds
 * @acceptance-criteria AC-PREFLIGHT.1 through AC-PREFLIGHT.8
 */

import * as fs from 'fs';
import * as path from 'path';
import { SpecMonitor } from '../monitors/spec-monitor.js';
import { SpecReconciler } from './spec-reconciler/reconciler.js';
import { parseSpecFile } from './spec-reconciler/parser.js';
import { autoFixCheckbox } from './spec-reconciler/auto-fixer.js';
import {
  PreflightReport,
  PreflightStatus,
  UserChoice,
  ChoiceResult,
  DriftResult,
  ParsedSpec,
} from './spec-reconciler/types.js';

/**
 * BuildPreflightService - Runs pre-flight checks before builds.
 *
 * Checks spec files for drift and coverage, providing options
 * for fixing, proceeding, or updating specs.
 */
export class BuildPreflightService {
  private readonly specMonitor: SpecMonitor;
  private readonly reconciler: SpecReconciler;
  private readonly basePath: string;

  constructor(
    specMonitor: SpecMonitor,
    reconciler: SpecReconciler,
    basePath?: string
  ) {
    this.specMonitor = specMonitor;
    this.reconciler = reconciler;
    this.basePath = basePath ?? process.cwd();
  }

  /**
   * Run a pre-flight check for a feature.
   *
   * @param feature - The feature name to check
   * @returns PreflightReport with status, coverage, and drifts
   */
  async runPreflightCheck(feature: string): Promise<PreflightReport> {
    const timestamp = new Date().toISOString();
    const specPath = this.specMonitor.getSpecPath(feature);

    // Check if spec file exists
    if (!fs.existsSync(specPath)) {
      return {
        status: 'error',
        feature,
        specPath,
        coverage: {
          components: { total: 0, implemented: 0, ratio: 0 },
          criteria: { total: 0, implemented: 0, ratio: 0 },
          behaviors: { total: 0, implemented: 0, ratio: 0 },
        },
        drifts: [],
        timestamp,
      };
    }

    // Read and parse the spec file
    const content = await fs.promises.readFile(specPath, 'utf-8');
    const spec = parseSpecFile(content, feature);

    // Calculate coverage for each section
    const componentsCoverage = this.specMonitor.calculateCoverage(spec.components);
    const criteriaCoverage = this.specMonitor.calculateCoverage(spec.criteria);
    const behaviorsCoverage = this.specMonitor.calculateCoverage(spec.behaviors);

    // Determine search paths for drift detection
    const srcDir = path.join(this.basePath, 'src');
    const testDir = path.join(this.basePath, 'test');
    const searchPaths = [srcDir];
    const testSearchPaths = [testDir];

    // Detect structural and criteria drift
    const structuralDrifts = await this.specMonitor.detectStructuralDrift(spec, searchPaths);
    const criteriaDrifts = await this.specMonitor.detectCriteriaDrift(spec, testSearchPaths);
    const allDrifts = [...structuralDrifts, ...criteriaDrifts];

    // Determine status
    let status: PreflightStatus;
    if (allDrifts.length > 0) {
      status = 'drift_detected';
    } else {
      status = 'pass';
    }

    return {
      status,
      feature,
      specPath,
      coverage: {
        components: componentsCoverage,
        criteria: criteriaCoverage,
        behaviors: behaviorsCoverage,
      },
      drifts: allDrifts,
      timestamp,
    };
  }

  /**
   * Handle user's choice for drift resolution.
   *
   * @param choice - The user's choice: 'fix', 'proceed', or 'update'
   * @param report - The pre-flight report containing drift information
   * @returns ChoiceResult indicating success and details
   */
  async handleUserChoice(
    choice: UserChoice,
    report: PreflightReport
  ): Promise<ChoiceResult> {
    switch (choice) {
      case 'fix':
        return await this.handleFix(report);
      case 'proceed':
        return this.handleProceed(report);
      case 'update':
        return await this.handleUpdate(report);
      default:
        return {
          action: choice,
          success: false,
          details: `Unknown choice: ${choice}`,
        };
    }
  }

  /**
   * Handle 'fix' choice by queuing reconciliation tasks.
   */
  private async handleFix(report: PreflightReport): Promise<ChoiceResult> {
    if (report.drifts.length === 0) {
      return {
        action: 'fix',
        success: true,
        details: 'No drifts to fix',
      };
    }

    // Determine search paths
    const srcDir = path.join(this.basePath, 'src');
    const searchPaths = [srcDir];

    // Use the reconciler to fix drifts
    const reconcileReport = await this.reconciler.reconcile(
      report.drifts,
      report.feature,
      report.specPath,
      searchPaths
    );

    return {
      action: 'fix',
      success: true,
      details: `Reconciliation complete: ${reconcileReport.fixed} fixed, ${reconcileReport.queued} queued`,
    };
  }

  /**
   * Handle 'proceed' choice by logging accepted drift.
   */
  private handleProceed(report: PreflightReport): ChoiceResult {
    const driftCount = report.drifts.length;

    return {
      action: 'proceed',
      success: true,
      details: `Proceeding with ${driftCount} accepted drift(s)`,
    };
  }

  /**
   * Handle 'update' choice by modifying the spec file.
   */
  private async handleUpdate(report: PreflightReport): Promise<ChoiceResult> {
    if (report.drifts.length === 0) {
      return {
        action: 'update',
        success: true,
        details: 'No drifts to update in spec',
      };
    }

    let updatedCount = 0;

    // For each drift with a spec item, update the checkbox in the spec file
    for (const drift of report.drifts) {
      if (drift.specItem && drift.type === 'structural_missing') {
        // Check if the file actually exists (meaning we just need to check the box)
        const srcDir = path.join(this.basePath, 'src');
        const possiblePaths = [
          path.join(srcDir, `${drift.specItem.id}.ts`),
          path.join(srcDir, `${drift.specItem.id}.js`),
          path.join(srcDir, `${drift.specItem.id}.tsx`),
          path.join(srcDir, `${drift.specItem.id}.jsx`),
        ];

        const fileExists = possiblePaths.some((p) => fs.existsSync(p));

        if (fileExists) {
          const result = await autoFixCheckbox(report.specPath, drift.specItem.id);
          if (result.success) {
            updatedCount++;
          }
        }
      }
    }

    return {
      action: 'update',
      success: true,
      details: `Updated spec file: ${updatedCount} item(s) checked`,
    };
  }
}
