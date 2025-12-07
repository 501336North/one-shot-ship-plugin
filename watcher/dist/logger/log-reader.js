/**
 * LogReader - Real-time workflow log tailing and querying
 *
 * Provides chain memory by reading and querying the workflow log
 */
import * as fs from 'fs';
import * as path from 'path';
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
            try {
                const parsed = JSON.parse(line);
                entries.push(parsed);
            }
            catch {
                // Skip malformed JSON
                continue;
            }
        }
        return entries;
    }
}
//# sourceMappingURL=log-reader.js.map