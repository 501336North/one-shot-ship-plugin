# TDD Implementation Plan: SEO/AEO Expert Agent

## Overview

Create a world-class SEO/AEO (Search Engine Optimization / Answer Engine Optimization) expert agent that automatically optimizes frontend work for both traditional search engines and AI-powered answer engines. This agent should match or exceed capabilities of professional SEO agencies.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     SEO/AEO Expert Agent Flow                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Frontend Agent Work (react-specialist, nextjs-developer, etc.)      │
│                          │                                            │
│                          ▼                                            │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              Automatic SEO/AEO Analysis Trigger              │    │
│  │  - Detects frontend file changes (.tsx, .jsx, .html, etc.)  │    │
│  │  - Triggers seo-aeo-expert agent delegation                  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                          │                                            │
│                          ▼                                            │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                  seo-aeo-expert Agent                        │    │
│  │                                                               │    │
│  │  1. Technical SEO Audit                                      │    │
│  │     - Core Web Vitals analysis                               │    │
│  │     - Meta tags verification                                 │    │
│  │     - Structured data/Schema markup                          │    │
│  │     - Semantic HTML structure                                │    │
│  │                                                               │    │
│  │  2. AEO Optimization                                         │    │
│  │     - Answer-first content structure                         │    │
│  │     - Entity consistency                                     │    │
│  │     - FAQ schema implementation                              │    │
│  │     - Conversational query optimization                      │    │
│  │                                                               │    │
│  │  3. E-E-A-T Enhancement                                      │    │
│  │     - Experience signals                                     │    │
│  │     - Expertise indicators                                   │    │
│  │     - Authority markers                                      │    │
│  │     - Trust signals                                          │    │
│  │                                                               │    │
│  │  4. Implementation Recommendations                           │    │
│  │     - Specific code changes                                  │    │
│  │     - Schema markup additions                                │    │
│  │     - Content restructuring                                  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

## IP Protection Pattern

Following established pattern:
1. **Plugin wrapper** (`agents/seo-aeo-expert.md`) - Fetches prompt from API
2. **API prompt** (`packages/api/src/prompts/agents/seo-aeo-expert.md`) - Full expert content
3. **Plugin registration** - Add to `.claude-plugin/plugin.json` agents list

## Phases

---

## Phase 1: Create Agent Files (IP Protected)

### Task 1.1: Create Plugin Wrapper File

**Test Criteria:**
- File exists at `/agents/seo-aeo-expert.md`
- Contains frontmatter with name and description
- Contains Step 1: Check Authentication
- Contains Step 2: Fetch Agent Prompt (API URL)
- Contains Step 3: Execute the Fetched Prompt
- Contains Error Handling section
- Does NOT contain any proprietary SEO/AEO knowledge

**Implementation:**
Create wrapper following exact pattern from `react-specialist.md`

---

### Task 1.2: Create API Expert Prompt

**Test Criteria:**
- File exists at `packages/api/src/prompts/agents/seo-aeo-expert.md`
- Contains comprehensive SEO/AEO expertise:
  - Technical SEO fundamentals
  - Core Web Vitals optimization
  - Schema markup patterns
  - AEO best practices
  - E-E-A-T guidelines
  - Content structure optimization
- Contains MCP Tool Suite section
- Contains Communication Protocol section
- Contains Status Line Update section
- Matches quality/depth of `nextjs-developer.md`

**Implementation:**
Create expert prompt with world-class SEO/AEO knowledge

---

## Phase 2: Register Agent in Plugin

### Task 2.1: Update plugin.json

**Test Criteria:**
- `seo-aeo-expert` appears in agents list in `.claude-plugin/plugin.json`
- Description mentions SEO, AEO, and automatic optimization

**Implementation:**
Add agent registration to plugin manifest

---

## Phase 3: Frontend Agent Integration

### Task 3.1: Update react-specialist API Prompt

**Test Criteria:**
- `react-specialist.md` in API contains delegation instruction to `seo-aeo-expert`
- Instruction appears in "Integration with other agents" section
- Specifies when to delegate (component changes, new pages, content updates)

**Implementation:**
Add SEO/AEO delegation guidance to react-specialist

---

### Task 3.2: Update nextjs-developer API Prompt

**Test Criteria:**
- `nextjs-developer.md` in API contains delegation instruction to `seo-aeo-expert`
- Emphasizes SEO importance for Next.js apps
- Specifies automatic delegation for page components

**Implementation:**
Add SEO/AEO delegation guidance to nextjs-developer

---

### Task 3.3: Update frontend-developer API Prompt

**Test Criteria:**
- `frontend-developer.md` in API contains delegation instruction to `seo-aeo-expert`
- Covers all frontend frameworks (React, Vue, Angular, etc.)

**Implementation:**
Add SEO/AEO delegation guidance to frontend-developer

---

## Phase 4: Verification

### Task 4.1: Verify IP Protection

**Test Criteria:**
- Plugin wrapper contains NO proprietary knowledge
- All expertise lives in API prompt only
- API prompt not accessible without authentication

**Implementation:**
Audit both files for IP leakage

---

### Task 4.2: Test Agent Invocation

**Test Criteria:**
- Agent can be invoked via Task tool with `subagent_type: "seo-aeo-expert"`
- Agent fetches prompt from API successfully
- Agent provides actionable SEO/AEO recommendations

**Implementation:**
Manual testing of agent functionality

---

## Expert Prompt Content Outline

The API prompt should include:

### 1. Technical SEO Mastery
- Core Web Vitals (LCP < 2.5s, CLS < 0.1, INP < 200ms, TTFB < 800ms)
- Meta tag optimization (title, description, canonical, robots)
- Semantic HTML structure (proper heading hierarchy, landmarks)
- Mobile-first responsive design
- Page speed optimization techniques
- URL structure best practices
- Internal linking strategy
- Image optimization (alt text, lazy loading, modern formats)

### 2. Schema Markup Expertise
- JSON-LD implementation patterns
- Organization schema
- Article/BlogPosting schema
- Product schema (e-commerce)
- FAQ schema (AEO critical)
- HowTo schema
- BreadcrumbList schema
- LocalBusiness schema
- Person/Author schema (E-E-A-T)
- Review/Rating schema

### 3. AEO (Answer Engine Optimization)
- Answer-first content structure
- Featured snippet optimization
- People Also Ask (PAA) targeting
- Zero-click result optimization
- Conversational query patterns
- Entity consistency across content
- Voice search optimization
- AI overview/SGE optimization
- Citation-worthy content structure
- Multi-format content (text, video, audio optimization)

### 4. E-E-A-T Enhancement
- **Experience**: First-hand experience signals, testimonials, case studies
- **Expertise**: Author bios, credentials, professional background
- **Authoritativeness**: Backlink strategy, mentions, industry recognition
- **Trustworthiness**: HTTPS, privacy policy, contact info, reviews

### 5. Content Optimization
- Keyword research integration
- Content hierarchy (H1-H6)
- Readability optimization
- Content freshness signals
- Internal linking strategy
- External linking best practices
- Content length guidelines
- Engagement optimization

### 6. Performance Metrics
- Lighthouse score targets (Performance > 90, SEO > 95, Accessibility > 90)
- Core Web Vitals thresholds
- Page speed benchmarks
- Mobile usability requirements

### 7. Implementation Patterns
- React/Next.js SEO components
- Meta tag management (next/head, react-helmet)
- Sitemap generation
- Robots.txt configuration
- Open Graph / Twitter Cards
- Canonical URL management
- Hreflang for internationalization

---

## Task Count Summary

| Phase | Tasks |
|-------|-------|
| Phase 1: Create Agent Files | 2 |
| Phase 2: Register Agent | 1 |
| Phase 3: Frontend Integration | 3 |
| Phase 4: Verification | 2 |
| **Total** | **8** |

---

## Acceptance Criteria

1. SEO/AEO expert agent follows IP protection pattern (wrapper + API)
2. Agent contains world-class SEO/AEO knowledge
3. Frontend agents (react, nextjs, frontend) auto-delegate to seo-aeo-expert
4. Agent provides actionable, code-level recommendations
5. All schema markup patterns are production-ready
6. AEO optimization matches 2025-2026 best practices
7. E-E-A-T guidelines are comprehensive

---

## Dependencies

- Existing agent wrapper pattern (verified working)
- API prompt delivery infrastructure (verified working)
- Frontend agent prompts in API (need to update)

---

## Blockers

- None identified

---

## References

- [AEO Best Practices 2026](https://www.revvgrowth.com/aeo/answer-engine-optimization-best-practices)
- [HubSpot AEO Trends 2026](https://blog.hubspot.com/marketing/answer-engine-optimization-trends)
- [Structured Data SEO Guide 2026](https://phoenixseogeek.com/structured-data-seo/)
- [Schema Markup Strategy 2026](https://www.clickrank.ai/schema-markup/)
- [Google E-E-A-T Guidelines](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)
- [Core Web Vitals 2026](https://prateeksha.com/blog/on-page-seo-checklist-2026-titles-headings-schema-core-web-vitals)

---

## Last Updated: 2026-01-08 by /oss:plan
