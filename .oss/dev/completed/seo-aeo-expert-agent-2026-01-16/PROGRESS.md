# Progress: SEO/AEO Expert Agent

## Current Phase: build (complete)

## Tasks

### Phase 1: Create Agent Files
- [x] Task 1.1: Create plugin wrapper file (`agents/seo-aeo-expert.md`) (completed 2026-01-08)
- [x] Task 1.2: Create API expert prompt (`packages/api/src/prompts/agents/seo-aeo-expert.md`) (completed 2026-01-08)

### Phase 2: Register Agent
- [x] Task 2.1: Verify agent registration (40 agents in directory) (completed 2026-01-08)

### Phase 3: Frontend Agent Integration
- [x] Task 3.1: Update `react-specialist.md` API prompt with SEO delegation (completed 2026-01-08)
- [x] Task 3.2: Update `nextjs-developer.md` API prompt with SEO delegation (completed 2026-01-08)
- [x] Task 3.3: Update `frontend-developer.md` API prompt with SEO delegation (completed 2026-01-08)

### Phase 4: Verification
- [x] Task 4.1: Verify IP protection (no leakage) (completed 2026-01-08)
- [x] Task 4.2: Test agent invocation (completed 2026-01-08)

## Verification Results

### IP Protection Audit
- Plugin wrapper: 50 lines (authentication + API fetch only)
- API prompt: 807 lines (full SEO/AEO expertise)
- Zero proprietary knowledge in plugin file

### Files Created/Modified
| File | Location | Lines | Purpose |
|------|----------|-------|---------|
| `seo-aeo-expert.md` | plugin/agents/ | 50 | Wrapper (fetches from API) |
| `seo-aeo-expert.md` | api/prompts/agents/ | 807 | Full expert prompt |
| `react-specialist.md` | api/prompts/agents/ | +30 | SEO delegation section |
| `nextjs-developer.md` | api/prompts/agents/ | +35 | SEO delegation section |
| `frontend-developer.md` | api/prompts/agents/ | +40 | SEO delegation section |

### Agent Capabilities
- Technical SEO (Core Web Vitals, meta tags, semantic HTML)
- Schema Markup (JSON-LD for Organization, Article, FAQ, HowTo, Product, Person)
- AEO (Answer Engine Optimization for AI search)
- E-E-A-T Enhancement (Experience, Expertise, Authoritativeness, Trustworthiness)
- React/Next.js SEO components and patterns
- Performance audit targets (Lighthouse > 95)

## Blockers
- None

## Last Updated: 2026-01-08 by /oss:build
