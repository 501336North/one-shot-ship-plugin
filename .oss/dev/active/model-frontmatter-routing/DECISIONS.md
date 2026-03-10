# Technical Decisions: Model Frontmatter Routing

## Decision 1: Three-tier model strategy
**Context**: Need to optimize cost/quality across 107 prompts (44 agents + 63 commands)
**Decision**: Use three tiers — `model: opus` (force upgrade), no field (inherit parent), `model: haiku` (force downgrade)
**Rationale**: Inherit-parent is the safest default — respects what the user is paying for. Only override when there's a clear reason.

## Decision 2: `model:` is independent of `model_routing:`
**Context**: Existing `model_routing: true` enables external provider proxy routing
**Decision**: The two fields are orthogonal. `model:` sets the native Claude default; `model_routing:` enables external overrides.
**Rationale**: When `model_routing` is active and user configures an external model, that takes precedence. `model:` only applies when using native Claude.

## Decision 3: Changes in plugin repo only
**Context**: API repo serves encrypted prompts with their own `model:` field
**Decision**: Only modify plugin repo (`one-shot-ship-plugin`). API prompts are a separate concern.
**Rationale**: Plugin .md files are what Claude Code reads for agent/command definitions. API prompts are injected content, not agent definitions.

## Last Updated: 2026-03-10 13:42 by /oss:plan
