import type { CreateTaskInput } from '../types.js';

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

    let prompt = `IRON LAW #${law} violated 3+ times\n\nMANDATORY: Fetch IRON LAWS and place at top of context\n\ncurl -s -H "Authorization: Bearer {apiKey}" https://one-shot-ship-api.onrender.com/api/v1/prompts/shared/iron-laws`;

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
