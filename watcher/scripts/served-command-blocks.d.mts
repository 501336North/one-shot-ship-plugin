// Types for served-command-blocks.mjs, so the served-commands tests type-check.

export interface CommandFile {
  key: string;
  file: string;
}
export type Blocks = Record<string, string[]>;

export declare const PLUGIN_ROOT: string;
export declare const DEFAULT_API_REPO: string;
export declare const API_FILES: string[];
export declare const FIXTURE: string;
export declare function bashBlocks(text: string): string[];
export declare function pluginCommandFiles(): CommandFile[];
export declare function apiCommandsDir(env?: Readonly<Record<string, string | undefined>>): string;
export declare function apiCommandFiles(env?: Readonly<Record<string, string | undefined>>): CommandFile[];
export declare function fixtureFiles(oldFiles: Blocks, pluginBlocks: Blocks, apiBlocks: Blocks | null): Blocks;
export declare function apiStatus(apiFiles: readonly CommandFile[], fixtureFilesNow: Blocks): string | null;
export declare function blocksOf(files: readonly CommandFile[]): Blocks;
