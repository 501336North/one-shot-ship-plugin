/**
 * Prompt change detection via manifest hash comparison.
 * Compares current prompt hash against cached value to detect updates.
 */
import type { UpdateState } from './update-state.js';

export interface ChangeDetectionResult {
  changed: boolean;
  firstRun: boolean;
  promptKey: string;
  updatedSignatures: Record<string, string>;
}

/**
 * Detect whether a prompt's hash has changed since last cached value.
 *
 * @param state - Current update state with cached signatures
 * @param type - Prompt type (commands, workflows, etc.)
 * @param name - Prompt name
 * @param currentHash - Current hash from manifest (null if unavailable)
 * @returns Detection result indicating change status and updated signatures to persist
 */
export function detectPromptChange(
  state: UpdateState,
  type: string,
  name: string,
  currentHash: string | null
): ChangeDetectionResult {
  const promptKey = `${type}/${name}`;

  if (currentHash === null) {
    return { changed: false, firstRun: false, promptKey, updatedSignatures: {} };
  }

  const cachedHash = state.promptSignatures[promptKey];
  const firstRun = cachedHash === undefined;
  const changed = !firstRun && cachedHash !== currentHash;

  return {
    changed,
    firstRun,
    promptKey,
    updatedSignatures: { [promptKey]: currentHash },
  };
}
