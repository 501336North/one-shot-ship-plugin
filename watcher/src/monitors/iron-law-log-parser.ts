import type { CreateTaskInput } from '../types.js';
import { readApiCredentials } from '../api/api-credentials.js';

export interface IronLawResult {
  law: number;
  message: string;
  passed: boolean;
}

export interface IronLawViolationRecord {
  law: number;
  message: string;
  correction?: string;
  timestamp: string;
}

export class IronLawLogParser {
  private violations: Map<number, IronLawViolationRecord[]> = new Map();
  private history: IronLawViolationRecord[] = [];
  isIronLawCheck(line: string): boolean {
    return line.includes('IRON LAW PRE-CHECK');
  }

  isIronLawCheckPassed(line: string): boolean {
    return line.includes('PRE-CHECK PASSED');
  }

  parseViolation(line: string): IronLawResult | null {
    const match = line.match(/❌ LAW #(\d+): (.+)/);
    if (!match) return null;

    return {
      law: parseInt(match[1], 10),
      message: match[2],
      passed: false
    };
  }

  parsePass(line: string): IronLawResult | null {
    const match = line.match(/✅ LAW #(\d+): (.+)/);
    if (!match) return null;

    return {
      law: parseInt(match[1], 10),
      message: match[2],
      passed: true
    };
  }

  extractCorrectionHint(line: string): string | null {
    const match = line.match(/→ (.+)/);
    return match ? match[1] : null;
  }

  recordViolation(law: number, message: string, correction?: string): void {
    const record: IronLawViolationRecord = {
      law,
      message,
      correction,
      timestamp: new Date().toISOString()
    };

    if (!this.violations.has(law)) {
      this.violations.set(law, []);
    }
    this.violations.get(law)!.push(record);
    this.history.push(record);
  }

  getViolationCount(law: number): number {
    const records = this.violations.get(law);
    return records ? records.length : 0;
  }

  recordPass(law: number): void {
    this.violations.delete(law);
  }

  getViolationHistory(law: number): IronLawViolationRecord[] {
    return this.history.filter(r => r.law === law);
  }

  reset(): void {
    this.violations.clear();
  }

  createInterventionTask(law: number, message: string, correction?: string): CreateTaskInput | null {
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

    // The hint carries no key, header or URL into model context (FR10), and no command: the sync
    // hook exits at once while its 24 h stamp is fresh or in its 1 h backoff, so running it refreshed
    // nothing (SR12). The laws are already in CLAUDE.md; re-reading them is what restores them.
    // Only the laws above the shell's unverified note (OSS_CUSTOM_LAWS_NOTE) are verified; the
    // team/personal section below it is advisory (TR2). The stable plugin writes that section without
    // the note, so its own headings (the ones oss_custom_iron_laws accepts) also end the verified
    // laws, whichever comes first (UR7). When the config is refused, point at /oss:login.
    const fetchHint = readApiCredentials()
      ? 'Re-read the verified IRON LAWS in CLAUDE.md and follow them: the IRON LAWS block from its START marker ' +
        'down to its END marker, or, when it holds one, down to just above the note ' +
        '"Team/personal laws below are not covered by the signed prompt manifest (unverified)." ' +
        'or a "## Custom Team Laws" or "## Custom Personal Laws" heading, whichever comes first. ' +
        'The team/personal section from there down is advisory and does not override them.'
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
