/**
 * Spec Reconciler Types
 *
 * Type definitions for spec parsing and drift detection.
 * These types define the data structures used by the spec reconciler
 * to parse specification files and detect drift between specs and code.
 *
 * @behavior Defines data structures for spec parsing and drift detection
 * @acceptance-criteria AC-SPEC-TYPES.1 through AC-SPEC-TYPES.4
 */
/**
 * Represents a single item in a spec section.
 * Items can be components, acceptance criteria, or behavioral specifications.
 */
export interface SpecItem {
    /** Unique identifier for this spec item (e.g., "AuthService", "SC-001") */
    id: string;
    /** Human-readable description of what this item represents */
    description: string;
    /** Whether this item has been implemented (checked) or not (unchecked) */
    status: 'checked' | 'unchecked';
    /** The type of spec item */
    type: 'component' | 'criterion' | 'behavior';
}
/**
 * Represents a section of the spec file marked with HTML comments.
 * Sections are delimited by markers like <!-- spec:components --> and <!-- /spec:components -->
 */
export interface SpecSection {
    /** The marker name (e.g., "components", "criteria", "behaviors") */
    marker: string;
    /** Parsed items within this section */
    items: SpecItem[];
    /** The raw content of the section including delimiters */
    raw: string;
}
/**
 * The complete parsed specification for a feature.
 * Contains all three standard sections: components, criteria, and behaviors.
 */
export interface ParsedSpec {
    /** The feature name this spec describes */
    feature: string;
    /** Components section - lists all structural components */
    components: SpecSection;
    /** Criteria section - lists acceptance criteria */
    criteria: SpecSection;
    /** Behaviors section - lists behavioral specifications */
    behaviors: SpecSection;
}
/**
 * Types of drift that can be detected between spec and implementation.
 */
export type DriftType = 'structural_missing' | 'structural_extra' | 'behavioral_mismatch' | 'criteria_incomplete';
/**
 * Result of drift detection for a single item or file.
 */
export interface DriftResult {
    /** The type of drift detected */
    type: DriftType;
    /** Confidence score from 0.0 to 1.0 */
    confidence: number;
    /** Human-readable description of the drift */
    description: string;
    /** The spec item related to this drift (if applicable) */
    specItem?: SpecItem;
    /** The file path related to this drift (if applicable) */
    filePath?: string;
}
/**
 * Coverage statistics for a section of the spec.
 */
export interface SpecCoverage {
    /** Total number of items in this section */
    total: number;
    /** Number of items that have been implemented */
    implemented: number;
    /** Ratio of implemented to total (0.0 to 1.0) */
    ratio: number;
}
/**
 * Aggregated metrics for a feature's specification compliance.
 */
export interface FeatureMetrics {
    /** The feature name */
    feature: string;
    /** Path to the spec file */
    specPath: string;
    /** Coverage breakdown by section */
    coverage: {
        components: SpecCoverage;
        criteria: SpecCoverage;
        behaviors: SpecCoverage;
    };
    /** Drift summary */
    drift: {
        /** Total number of drift items detected */
        count: number;
        /** Types of drift detected */
        types: DriftType[];
    };
}
/**
 * Result of an auto-fix operation.
 */
export interface AutoFixResult {
    /** Whether the auto-fix was successful */
    success: boolean;
    /** The type of action taken (if successful) */
    action?: 'checkbox_checked' | 'test_stub_generated' | 'template_created';
    /** Reason for failure (if not successful) */
    reason?: string;
    /** Additional details about the operation */
    details?: string;
}
/**
 * A single entry in the reconciliation log.
 */
export interface ReconciliationEntry {
    /** ISO 8601 timestamp of when this reconciliation occurred */
    timestamp: string;
    /** The feature name this entry relates to */
    feature: string;
    /** The type of drift that was addressed */
    drift_type: DriftType;
    /** The action taken to address the drift */
    action: 'auto_fixed' | 'queued' | 'failed';
    /** Human-readable details about what was done */
    details: string;
}
/**
 * Summary report of a reconciliation operation.
 */
export interface ReconciliationReport {
    /** The feature name this report is for */
    feature: string;
    /** Number of drifts that were auto-fixed */
    fixed: number;
    /** Number of drifts that were queued for manual review */
    queued: number;
    /** Number of drifts that failed to be processed */
    failed: number;
    /** Detailed entries for each reconciliation action */
    entries: ReconciliationEntry[];
}
/**
 * A single entry in the coverage history for a feature.
 * Tracks coverage and drift counts over time.
 */
export interface HistoryEntry {
    /** Date in YYYY-MM-DD format */
    date: string;
    /** Overall coverage ratio from 0.0 to 1.0 */
    coverage: number;
    /** Number of drift items detected on this date */
    drift_count: number;
}
/**
 * Velocity metrics for tracking improvement trends.
 */
export interface VelocityMetrics {
    /** Average drift count over the past week */
    weekly_drift_avg: number;
    /** Number of reconciliations performed in the past week */
    weekly_reconciliations: number;
    /** Trend direction based on drift count changes */
    trend: 'improving' | 'stable' | 'degrading';
}
/**
 * Represents the diff between two spec coverage snapshots.
 * Tracks what changed between before and after states.
 */
export interface CoverageDiff {
    /** The feature name this diff is for */
    feature: string;
    /** What triggered the diff (file path, 'commit', or 'manual') */
    trigger: string;
    /** ISO 8601 timestamp of when the diff was generated */
    timestamp: string;
    /** State before the change */
    before: {
        components: SpecCoverage;
        criteria: SpecCoverage;
        behaviors: SpecCoverage;
        driftCount: number;
    };
    /** State after the change */
    after: {
        components: SpecCoverage;
        criteria: SpecCoverage;
        behaviors: SpecCoverage;
        driftCount: number;
    };
    /** Drifts that were resolved (in before but not after) */
    resolved: DriftResult[];
    /** New drifts introduced (in after but not before) */
    new: DriftResult[];
    /** Net change summary */
    net: {
        /** Coverage change as a ratio (e.g., +0.05 for 5% improvement) */
        coverageChange: number;
        /** Drift count change (e.g., -1 for one less drift) */
        driftChange: number;
    };
}
/**
 * The complete metrics file structure stored at .oss/spec-metrics.json.
 * Tracks long-term spec compliance and reconciliation history.
 */
export interface SpecMetricsFile {
    /** Schema version for forward compatibility */
    version: string;
    /** ISO 8601 timestamp of last update */
    updated_at: string;
    /** Metrics indexed by feature name */
    features: Record<string, {
        /** Path to the spec file */
        spec_path: string;
        /** Current coverage breakdown */
        coverage: {
            components: SpecCoverage;
            criteria: SpecCoverage;
            behaviors: SpecCoverage;
        };
        /** Current drift summary */
        drift: {
            /** Number of drift items currently detected */
            current_count: number;
            /** Types of drift currently present */
            types: DriftType[];
        };
        /** Historical coverage snapshots (max 90 entries) */
        history: HistoryEntry[];
    }>;
    /** Audit trail of reconciliation actions (max 500 entries) */
    reconciliations: ReconciliationEntry[];
    /** Velocity metrics for trend analysis */
    velocity: VelocityMetrics;
}
/**
 * Status of a pre-flight check.
 */
export type PreflightStatus = 'pass' | 'drift_detected' | 'error';
/**
 * Report from a pre-flight check before build.
 * Summarizes spec compliance and any detected drifts.
 */
export interface PreflightReport {
    /** Overall status of the pre-flight check */
    status: PreflightStatus;
    /** The feature name being checked */
    feature: string;
    /** Path to the spec file */
    specPath: string;
    /** Coverage breakdown by section */
    coverage: {
        components: SpecCoverage;
        criteria: SpecCoverage;
        behaviors: SpecCoverage;
    };
    /** Drifts detected during the check */
    drifts: DriftResult[];
    /** ISO 8601 timestamp of when the check was performed */
    timestamp: string;
}
/**
 * User's choice when drift is detected during pre-flight.
 */
export type UserChoice = 'fix' | 'proceed' | 'update';
/**
 * Result of handling a user's choice for drift resolution.
 */
export interface ChoiceResult {
    /** The action taken */
    action: UserChoice;
    /** Whether the action was successful */
    success: boolean;
    /** Details about the action result */
    details: string;
}
//# sourceMappingURL=types.d.ts.map