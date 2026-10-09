# Implementation Notes: Model Frontmatter Routing

## Frontmatter Format

### Agents (with model_routing)
```yaml
---
name: code-reviewer
description: Expert code reviewer...
model: opus
model_routing: true
context: fork
---
```

### Agents (without model_routing)
```yaml
---
name: docs-architect
description: Documentation specialist...
model: haiku
---
```

### Commands
```yaml
---
description: Generate a TDD implementation plan...
model: opus
---
```

## Key Insight
Adding `model: sonnet` to agents would be a FORCED DOWNGRADE when user runs Opus.
The correct default is NO field (inherit parent model).

## Valid model values
- `opus` — Claude Opus (most capable, most expensive)
- `sonnet` — Claude Sonnet (balanced)
- `haiku` — Claude Haiku (fastest, cheapest)

## Last Updated: 2026-03-10 13:42 by /oss:plan
