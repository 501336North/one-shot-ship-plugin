/**
 * The value at `keys` inside `value` (a parsed log entry's `data` or a JSON payload: Record<string, unknown>),
 * or undefined where the path breaks off. Lets a test assert on a nested field without casting the payload to a
 * shape it may not have (T75e).
 */
export function at(value: unknown, ...keys: Array<string | number>): unknown {
  let current: unknown = value;
  for (const key of keys) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}
