/**
 * The ONE routing rule for model-run CLIs (notify-routing-unify D1). Twin of oss_resolve_project
 * in hooks/oss-safe-path.sh; keep the rules identical.
 *
 * CLAUDE_PROJECT_DIR if set, else the nearest real (not linked) .oss walking up from the cwd,
 * bounded by the git toplevel, else null (the caller uses the global ~/.oss).
 * ~/.oss/current-project is never read: it names whichever session started last.
 */
export declare function resolveProjectDir(env: Record<string, string | undefined>, cwd?: string): string | null;
//# sourceMappingURL=project-dir.d.ts.map