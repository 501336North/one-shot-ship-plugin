/**
 * DaemonCli - Command-line interface for the OSS Daemon
 *
 * Provides start/stop/status commands for managing the daemon lifecycle.
 */
export interface CliConfig {
    ossDir: string;
}
export interface CliCommand {
    action: 'start' | 'stop' | 'status' | 'install' | 'uninstall' | 'help' | 'version';
    flags: {
        daemonize?: boolean;
        dryRun?: boolean;
        help?: boolean;
        version?: boolean;
    };
}
export interface CliResult {
    success: boolean;
    output: string;
    exitCode: number;
}
export declare class DaemonCli {
    private config;
    private daemon;
    private launchd;
    private stopResolver;
    constructor(config: CliConfig);
    /**
     * Parse command-line arguments
     */
    parseCommand(args: string[]): CliCommand;
    /**
     * Execute a command
     */
    execute(args: string[]): Promise<CliResult>;
    /**
     * Status command implementation
     */
    private statusCommand;
    /**
     * Start command implementation
     */
    private startCommand;
    /**
     * Stop command implementation
     */
    private stopCommand;
    /**
     * Install command implementation (launchd)
     */
    private installCommand;
    /**
     * Uninstall command implementation
     */
    private uninstallCommand;
}
//# sourceMappingURL=cli.d.ts.map