export type RuleId =
  | 'protected-branch'
  | 'force-push'
  | 'tags'
  | 'production-host'
  | 'focused-tests'
  | 'protected-path'
  | 'protected-path-mention'
  | 'red-cycle'
  | 'unreadable'
  | 'gate-agent-write';

export interface Refusal {
  rule: RuleId;
  reason: string;
}
