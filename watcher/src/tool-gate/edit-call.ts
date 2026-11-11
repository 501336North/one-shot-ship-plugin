/**
 * Reads a Claude Code edit-tool call (Edit, MultiEdit, Write, NotebookEdit) into one shape: the
 * tool, the absolute file path (joined onto cwd, `~/` expanded, `..` kept) and each change as the text
 * before and after. For Write, "before" is the file's current content ('' when missing). Any
 * other tool, or input not shaped as expected, gives null.
 */

import { joinRaw } from './raw-path.js';

export type EditTool = 'Edit' | 'Write' | 'MultiEdit' | 'NotebookEdit';

export interface EditCall {
  tool: EditTool;
  /** Absolute, joined onto cwd as text: a `..` after a folder name is kept for the disk to resolve. */
  filePath: string;
  changes: { before: string; after: string }[];
}

type Change = EditCall['changes'][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function resolvePath(filePath: string, cwd: string, home: string): string {
  return filePath.startsWith('~/') ? joinRaw(home, filePath.slice(2)) : joinRaw(cwd, filePath);
}

function readChange(edit: unknown): Change | null {
  if (!isRecord(edit) || typeof edit.old_string !== 'string' || typeof edit.new_string !== 'string') return null;
  return { before: edit.old_string, after: edit.new_string };
}

function readChanges(
  tool: EditTool,
  input: Record<string, unknown>,
  absPath: string,
  readFile: (p: string) => string | null,
): Change[] | null {
  switch (tool) {
    case 'Edit': {
      const change = readChange(input);
      return change === null ? null : [change];
    }
    case 'MultiEdit': {
      if (!Array.isArray(input.edits)) return null;
      const changes = input.edits.map(readChange);
      return changes.every((change): change is Change => change !== null) ? changes : null;
    }
    case 'Write':
      if (typeof input.content !== 'string') return null;
      return [{ before: readFile(absPath) ?? '', after: input.content }];
    case 'NotebookEdit':
      if (typeof input.new_source !== 'string') return null;
      return [{ before: '', after: input.edit_mode === 'delete' ? '' : input.new_source }];
  }
}

const PATH_FIELD: Record<EditTool, string> = {
  Edit: 'file_path',
  MultiEdit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
};

function isEditTool(toolName: string): toolName is EditTool {
  return Object.hasOwn(PATH_FIELD, toolName);
}

/**
 * The tool and file an edit-tool call targets, read from the path field alone, so a call whose
 * other fields are missing or unexpected (a NotebookEdit delete with no new_source) still gets
 * the protected-path check.
 */
export function readEditTarget(
  toolName: string,
  toolInput: unknown,
  cwd: string,
  home: string,
): Pick<EditCall, 'tool' | 'filePath'> | null {
  if (!isEditTool(toolName) || !isRecord(toolInput)) return null;
  const rawPath = toolInput[PATH_FIELD[toolName]];
  if (typeof rawPath !== 'string') return null;
  return { tool: toolName, filePath: resolvePath(rawPath, cwd, home) };
}

export function readEditCall(
  toolName: string,
  toolInput: unknown,
  cwd: string,
  home: string,
  readFile: (p: string) => string | null,
): EditCall | null {
  const target = readEditTarget(toolName, toolInput, cwd, home);
  if (target === null || !isRecord(toolInput)) return null;
  const changes = readChanges(target.tool, toolInput, target.filePath, readFile);
  return changes === null ? null : { ...target, changes };
}
