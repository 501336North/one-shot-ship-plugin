# Testing Strategy: Model Frontmatter Routing

## Test Files
- `test/agents/model-frontmatter.test.ts` — Agent frontmatter validation
- `test/commands/model-frontmatter.test.ts` — Command frontmatter validation

## Approach
Parse YAML frontmatter from .md files and validate:
1. Opus agents have `model: "opus"`
2. Haiku agents have `model: "haiku"`
3. Inherit agents have NO `model` field
4. All model values are valid enum members (opus/sonnet/haiku)
5. `model` and `model_routing` coexist without conflict

## Results
- Pending (plan phase)

## Last Updated: 2026-03-10 13:42 by /oss:plan
