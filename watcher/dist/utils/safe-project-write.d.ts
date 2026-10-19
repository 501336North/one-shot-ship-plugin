export interface SafeWriteOptions {
    /** Create missing directories (default true). When false a missing one throws ENOENT. */
    createDirs?: boolean;
}
/** Ensure ossDir/relDir exists safely. */
export declare function safeMkdirOss(ossDir: string, relDir?: string): boolean;
/** Replace ossDir/rel with data: O_EXCL temp file in the same directory, then rename. */
export declare function safeWriteFileAtomic(ossDir: string, rel: string, data: string, options?: SafeWriteOptions): boolean;
/** Append data to ossDir/rel with O_APPEND|O_NOFOLLOW; the opened fd is re-checked (fstat). */
export declare function safeAppendFile(ossDir: string, rel: string, data: string, options?: SafeWriteOptions): boolean;
//# sourceMappingURL=safe-project-write.d.ts.map