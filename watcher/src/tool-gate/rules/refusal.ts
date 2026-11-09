export type RuleId =
  | 'protected-branch'
  | 'force-push'
  | 'tags'
  | 'production-host'
  | 'focused-tests'
  | 'protected-path'
  | 'red-cycle';

export interface Refusal {
  rule: RuleId;
  reason: string;
}
