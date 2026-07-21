/**
 * LogReader - Real-time workflow log tailing and querying
 *
 * Provides chain memory by reading and querying the workflow log
 */
import * as fs from 'fs';
import * as path from 'path';
import { OSSError } from '../services/error-codes.js';
export class LogReader {
    logPath;
    tailCallback = null;
    tailInterval = null;
    lastReadPosition = 0;
    constructor(ossDir) {
        this.logPath = path.join(ossDir, 'workflow.log');
    }
    /**
     * Read all entries from the log file
     */
    async readAll() {
        if (!fs.existsSync(this.logPath)) {
            return [];
        }
        const content = fs.readFileSync(this.logPath, 'utf-8');
        return this.parseContent(content);
    }
    /**
     * Start tailing the log file for new entries
     */
    startTailing(callback) {
        this.tailCallback = callback;
        // Get current file size as starting position
        if (fs.existsSync(this.logPath)) {
            const stats = fs.statSync(this.logPath);
            this.lastReadPosition = stats.size;
        }
        else {
            this.lastReadPosition = 0;
        }
        // Poll for changes every 50ms
        this.tailInterval = setInterval(() => this.checkForNewEntries(), 50);
    }
    /**
     * Stop tailing the log file
     */
    stopTailing() {
        if (this.tailInterval) {
            clearInterval(this.tailInterval);
            this.tailInterval = null;
        }
        this.tailCallback = null;
    }
    /**
     * Query for the last entry matching the filter
     */
    async queryLast(filter) {
        const entries = await this.readAll();
        // Search from end
        for (let i = entries.length - 1; i >= 0; i--) {
            const entry = entries[i];
            if (filter.cmd && entry.cmd !== filter.cmd)
                continue;
            if (filter.event && entry.event !== filter.event)
                continue;
            if (filter.phase && entry.phase !== filter.phase)
                continue;
            return entry;
        }
        return null;
    }
    checkForNewEntries() {
        if (!this.tailCallback || !fs.existsSync(this.logPath)) {
            return;
        }
        const stats = fs.statSync(this.logPath);
        if (stats.size <= this.lastReadPosition) {
            return;
        }
        // Read new content
        const fd = fs.openSync(this.logPath, 'r');
        const buffer = Buffer.alloc(stats.size - this.lastReadPosition);
        fs.readSync(fd, buffer, 0, buffer.length, this.lastReadPosition);
        fs.closeSync(fd);
        this.lastReadPosition = stats.size;
        const newContent = buffer.toString('utf-8');
        const entries = this.parseContent(newContent);
        for (const entry of entries) {
            this.tailCallback(entry);
        }
    }
    parseContent(content) {
        if (!content.trim()) {
            return [];
        }
        const lines = content.trim().split('\n');
        const entries = [];
        for (const line of lines) {
            // Skip human summary lines
            if (line.startsWith('#')) {
                continue;
            }
            // Skip empty lines
            if (!line.trim()) {
                continue;
            }
            let parsed;
            try {
                parsed = JSON.parse(line);
            }
            catch {
                // Malformed JSON: a line claiming to be an error is wrapped as
                // OSS-WORKFLOW-901 (never dropped); anything else is skipped as before
                if (line.includes('OSS_ERROR')) {
                    entries.push(this.wrapNonconforming(line));
                }
                continue;
            }
            if (parsed.event === 'OSS_ERROR') {
                // Validation net: only schema-valid wire errors pass through
                try {
                    OSSError.fromWireJSON(parsed.data);
                    entries.push(parsed);
                }
                catch {
                    entries.push(this.wrapNonconforming(line, parsed));
                }
                continue;
            }
            entries.push(parsed);
        }
        return entries;
    }
    /**
     * Wrap a nonconforming error line into a conformant OSS_ERROR entry
     * (code OSS-WORKFLOW-901) so it is never thrown and never silently dropped.
     */
    wrapNonconforming(line, original) {
        return {
            ts: original?.ts ?? new Date().toISOString(),
            cmd: original?.cmd ?? 'unknown',
            event: 'OSS_ERROR',
            data: {
                code: 'OSS-WORKFLOW-901',
                severity: 'MEDIUM',
                source: 'log-reader',
                message: 'Nonconforming error output wrapped',
                retry_eligible: false,
                retry_cost: 'cheap',
                attempt: 0,
                context: { original_line: line },
            },
        };
    }
}
//# sourceMappingURL=log-reader.js.map