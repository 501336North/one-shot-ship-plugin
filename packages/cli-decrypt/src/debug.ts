/**
 * Debug utilities for OSS Decrypt CLI
 * Provides formatted debug output with timestamps and redaction
 */

export type DebugStep = 'FETCH' | 'DERIVE' | 'DECRYPT' | 'CACHE' | 'SECURITY';

/**
 * Format a timestamp for debug output
 */
function formatTimestamp(): string {
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Format debug output with timestamp and step marker
 */
export function formatDebugOutput(step: DebugStep, message: string): string {
  return `[${formatTimestamp()}] [${step}] ${message}`;
}

/**
 * Redact sensitive data from an object
 */
export function redactSensitiveData<T extends Record<string, unknown>>(obj: T): T {
  const sensitiveKeys = ['apiKey', 'salt', 'password', 'secret', 'token'];
  const result = { ...obj } as T;

  for (const key of Object.keys(result)) {
    const value = result[key as keyof T];

    if (sensitiveKeys.includes(key)) {
      if (key === 'apiKey' && typeof value === 'string') {
        (result as Record<string, unknown>)[key] = 'ak_***';
      } else {
        (result as Record<string, unknown>)[key] = '***';
      }
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      (result as Record<string, unknown>)[key] = redactSensitiveData(
        value as Record<string, unknown>
      );
    }
  }

  return result;
}

/**
 * Debug logger that conditionally outputs based on debug flag
 */
export class DebugLogger {
  private enabled: boolean;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  log(step: DebugStep, message: string): void {
    if (!this.enabled) {
      return;
    }
    console.error(formatDebugOutput(step, message));
  }

  logObject(step: DebugStep, label: string, obj: Record<string, unknown>): void {
    if (!this.enabled) {
      return;
    }
    const redacted = redactSensitiveData(obj);
    console.error(formatDebugOutput(step, `${label}: ${JSON.stringify(redacted)}`));
  }
}
