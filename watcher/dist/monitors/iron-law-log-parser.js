import { readApiCredentials } from '../api/api-credentials.js';
export class IronLawLogParser {
    violations = new Map();
    history = [];
    isIronLawCheck(line) {
        return line.includes('IRON LAW PRE-CHECK');
    }
    isIronLawCheckPassed(line) {
        return line.includes('PRE-CHECK PASSED');
    }
    parseViolation(line) {
        const match = line.match(/❌ LAW #(\d+): (.+)/);
        if (!match)
            return null;
        return {
            law: parseInt(match[1], 10),
            message: match[2],
            passed: false
        };
    }
    parsePass(line) {
        const match = line.match(/✅ LAW #(\d+): (.+)/);
        if (!match)
            return null;
        return {
            law: parseInt(match[1], 10),
            message: match[2],
            passed: true
        };
    }
    extractCorrectionHint(line) {
        const match = line.match(/→ (.+)/);
        return match ? match[1] : null;
    }
    recordViolation(law, message, correction) {
        const record = {
            law,
            message,
            correction,
            timestamp: new Date().toISOString()
        };
        if (!this.violations.has(law)) {
            this.violations.set(law, []);
        }
        this.violations.get(law).push(record);
        this.history.push(record);
    }
    getViolationCount(law) {
        const records = this.violations.get(law);
        return records ? records.length : 0;
    }
    recordPass(law) {
        this.violations.delete(law);
    }
    getViolationHistory(law) {
        return this.history.filter(r => r.law === law);
    }
    reset() {
        this.violations.clear();
    }
    createInterventionTask(law, message, correction) {
        const count = this.getViolationCount(law);
        if (count === 1) {
            return null;
        }
        if (count === 2) {
            let prompt = message;
            if (correction) {
                prompt += `\n\n${correction}`;
            }
            return {
                priority: 'low',
                source: 'iron-law-monitor',
                anomaly_type: 'iron_law_violation',
                prompt,
                suggested_agent: 'debugger',
                context: {
                    law
                }
            };
        }
        // The allowlisted sync hook fetches with the key itself, so the hint carries no key, header or
        // URL into model context (FR10); when the config is refused, point at /oss:login instead
        const fetchHint = readApiCredentials()
            ? 'Run ~/.oss/hooks/oss-iron-laws-sync.sh, then re-read the IRON LAWS block in CLAUDE.md'
            : 'No usable OSS config (apiKey, apiUrl): run /oss:login';
        let prompt = `IRON LAW #${law} violated 3+ times\n\nMANDATORY: Fetch IRON LAWS and place at top of context\n\n${fetchHint}`;
        if (correction) {
            prompt += `\n\n${correction}`;
        }
        return {
            priority: 'high',
            source: 'iron-law-monitor',
            anomaly_type: 'iron_law_repeated',
            prompt,
            suggested_agent: 'debugger',
            context: {
                law
            }
        };
    }
}
//# sourceMappingURL=iron-law-log-parser.js.map