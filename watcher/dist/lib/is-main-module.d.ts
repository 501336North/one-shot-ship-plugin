/**
 * isMainModule — true when the file node was asked to run (argv[1]) is this module.
 *
 * Node usually resolves import.meta.url to the module's REAL path, but keeps the link path under
 * --preserve-symlinks-main, and argv[1] is the path as typed: compare the real paths of both sides.
 * A path that cannot be resolved is never the main module (fail closed).
 */
export declare function isMainModule(metaUrl: string, argv1: string | undefined): boolean;
//# sourceMappingURL=is-main-module.d.ts.map