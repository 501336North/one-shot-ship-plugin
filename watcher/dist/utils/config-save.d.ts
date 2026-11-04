/**
 * The one safe read-merge-write of a JSON config the person keeps (T80): ~/.oss/config.json, which holds the OSS
 * apiKey, saved by /oss:models and WebhookConfig. Only a missing file starts from {}; a file that is not a regular
 * file holding a JSON object is refused (NotSaved) and never written, so a save never hangs on a FIFO and never
 * replaces a file it could not read. A link is followed (dotfiles), as the T70c settings.json writers do, and the
 * saved file is owner-only (600) whatever the umask or the mode an older writer left.
 */
/** A save refused: the message says which file and why; nothing was written. */
export declare class NotSaved extends Error {
    constructor(file: string, why: string);
}
/** The JSON object in `file` to merge into, {} when there is no file; throws NotSaved for anything else. */
export declare function loadConfigForSave(file: string): Record<string, unknown>;
/**
 * Write `config` to `file` (its folder must exist). Opened non-blocking and checked on the open file, so a FIFO or
 * device swapped in since the load is refused (NotSaved) instead of blocking or being written. Created at 600 and
 * fchmod'ed to 600, so neither the umask nor an older mode leaves it readable by others.
 */
export declare function saveConfigFile(file: string, config: Record<string, unknown>): void;
//# sourceMappingURL=config-save.d.ts.map