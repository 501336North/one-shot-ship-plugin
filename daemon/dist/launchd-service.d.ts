/**
 * LaunchdService - Manages daemon lifecycle on macOS via launchd
 *
 * Generates plist files and provides commands for loading/unloading the daemon.
 */
export interface LaunchdConfig {
    ossDir: string;
    label: string;
    daemonPath?: string;
}
export declare class LaunchdService {
    private config;
    constructor(config: LaunchdConfig);
    /**
     * Generate launchd plist XML content
     */
    generatePlist(): string;
    /**
     * Get the path where the plist file should be installed
     */
    getPlistPath(): string;
    /**
     * Write plist file to LaunchAgents directory
     */
    writePlist(): Promise<string>;
    /**
     * Check if the service plist file is installed
     */
    isInstalled(): Promise<boolean>;
    /**
     * Check if the service is currently running
     */
    isRunning(): Promise<boolean>;
    /**
     * Get the launchctl load command
     */
    getLoadCommand(): string;
    /**
     * Get the launchctl unload command
     */
    getUnloadCommand(): string;
    /**
     * Load the service using launchctl
     */
    load(): Promise<void>;
    /**
     * Unload the service using launchctl
     */
    unload(): Promise<void>;
    /**
     * Remove the plist file
     */
    uninstall(): Promise<void>;
}
//# sourceMappingURL=launchd-service.d.ts.map