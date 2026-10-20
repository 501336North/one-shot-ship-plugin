/**
 * The ONE routing rule for model-run CLIs (notify-routing-unify D1). Twin of oss_resolve_project
 * in hooks/oss-safe-path.sh; keep the rules identical.
 *
 * CLAUDE_PROJECT_DIR if set, else this session's pointer (sessionProjectDir), else the nearest real (not linked) .oss walking up from the cwd,
 * stopping at (and including) the first directory holding a .git entry (no git call), else null (the caller uses the global ~/.oss).
 * ~/.oss/current-project is never read: it names whichever session started last.
 */
export declare function resolveProjectDir(env: Record<string, string | undefined>, cwd?: string): string | null;
/**
 * This session's pointer ~/.oss/sessions/<CLAUDE_CODE_SESSION_ID>/project (D2), written by the
 * SessionStart hook. Twin of oss_session_project: the id is ^[A-Za-z0-9-]{1,100}$; the sessions
 * folder, the id folder and the file are the user's own and not links; the content is one absolute
 * line naming a folder with a real .oss. Anything else: null.
 */
export declare function sessionProjectDir(env: Record<string, string | undefined>): string | null;
//# sourceMappingURL=project-dir.d.ts.map