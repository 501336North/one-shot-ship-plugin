# Design: Model Frontmatter Routing

## Summary
Add native Claude `model:` frontmatter to all agent and command .md files in the plugin repo to optimize cost/quality tradeoffs. Three tiers: `model: opus` for critical reasoning, no field for inherit-parent (majority), `model: haiku` for mechanical tasks.

## Rationale
- Agents without `model:` inherit parent model (current behavior = no change)
- `model: opus` forces upgrade for high-stakes tasks even when user runs Sonnet
- `model: haiku` saves cost on routine/display/config tasks with no quality loss
- Independent of existing `model_routing: true` (external provider proxy system)

## Scope
- **Repo:** one-shot-ship-plugin only
- **Files:** `agents/*.md` (44 files) + `commands/*.md` (63 files)
- **Change type:** YAML frontmatter only — no prompt content changes

## Agent Assignments

### Force Opus (8 agents)
| Agent | Rationale |
|-------|-----------|
| architecture-auditor | System design analysis, hard-to-reverse decisions |
| security-auditor | Must catch all vulnerabilities, high stakes |
| incident-responder | Critical production decisions under pressure |
| performance-auditor | Deep bottleneck root-cause analysis |
| backend-architect | Architectural decisions, hard to reverse |
| cloud-architect | Infrastructure architecture, cost implications |
| debugger | Root cause analysis across complex call chains |
| code-reviewer | Must catch subtle bugs and security issues |

### Inherit Parent (31 agents — no model field)
All language-specific coding agents, framework specialists, and engineering agents.

### Force Haiku (5 agents)
| Agent | Rationale |
|-------|-----------|
| dependency-analyzer | Pattern matching on dependency trees |
| docs-architect | Structured text generation, easily reviewed |
| git-workflow-manager | Mechanical git operations |
| release-manager | Routine versioning/changelog |
| seo-aeo-expert | Pattern-based meta/schema markup |

## Command Assignments

### Force Opus (6 commands)
plan, ideate, review, audit, postmortem, chaos

### Inherit Parent (40 commands)
build, red, green, refactor, ship, deploy, stage, rollback, test, smoke, acceptance, integration, contract, load, bench, debug, api-design, data-model, mock, iterate, quick, verify, visual-qa, tech-debt, a11y, design-review, feature-flag, experiment, monitor, trace, incident, cost, privacy, license, adr, requirements, onboard, retro, oss-custom, webhook

### Force Haiku (17 commands)
changelog, status, legend, settings, login, models, pause, resume, queue, watcher, telegram, workflows, oss, oss-audio, docs, release

<!-- figma_source: none -->
