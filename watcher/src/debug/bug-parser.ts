/**
 * Bug Input Parser
 * Parses error messages, stack traces, and descriptions from user input
 */

export interface BugInput {
  type: 'error';
  errorType: string;
  message: string;
}

export interface StackFrame {
  function: string;
  file: string;
  line: number;
  column: number;
}

export interface BugDescription {
  component?: string;
  expected?: string;
  actual?: string;
}

export interface ParsedBug {
  type: 'error';
  errorType: string;
  message?: string;
  component?: string;
  expected?: string;
  actual?: string;
}

/**
 * Parse error message input
 */
export function parseInput(input: string): BugInput {
  const match = input.match(/^(\w+Error):\s*(.+)$/);

  if (!match) {
    throw new Error('Invalid error format');
  }

  return {
    type: 'error',
    errorType: match[1],
    message: match[2],
  };
}

/**
 * Parse stack trace into frames
 */
export function parseStackTrace(trace: string): StackFrame[] {
  const lines = trace.split('\n');
  const frames: StackFrame[] = [];

  for (const line of lines) {
    const match = line.match(/at\s+(\w+)\s+\(([^:]+):(\d+):(\d+)\)/);
    if (match) {
      frames.push({
        function: match[1],
        file: match[2],
        line: parseInt(match[3], 10),
        column: parseInt(match[4], 10),
      });
    }
  }

  return frames;
}

/**
 * Parse natural language description
 */
export function parseDescription(text: string): BugDescription {
  const result: BugDescription = {};

  // Extract component (simple keyword matching)
  const componentMatch = text.match(/\b(login|auth|payment|user|form|dashboard|api)\b/i);
  if (componentMatch) {
    result.component = componentMatch[1].toLowerCase();
  }

  // Extract expected vs actual
  const behaviorMatch = text.match(/show\s+(.+?)\s+but\s+shows\s+(.+)/i);
  if (behaviorMatch) {
    result.expected = behaviorMatch[1].trim();
    result.actual = behaviorMatch[2].trim();
  }

  return result;
}

/**
 * Merge error input with description context
 */
export function mergeInputs(error: BugInput, description: BugDescription): ParsedBug {
  return {
    type: error.type,
    errorType: error.errorType,
    message: error.message,
    component: description.component,
    expected: description.expected,
    actual: description.actual,
  };
}
