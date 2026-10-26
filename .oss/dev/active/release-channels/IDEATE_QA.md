# Ideation Q&A Transcript: Release channels (DEV / STAGING / PROD)
Date: 2026-10-26
Original prompt: `/oss:ideate` "Yes /oss:ideate this" (in reply to the proposal: dev/staging/prod release channels for OSS; plugin + API/prompts; Boss-only tester now, external testers later; oss-lab out of scope)

## Context from the conversation before ideation
- Boss: "we have current customers that are relying on the current OSS version, so I'd like to have a better way of working on new stuff without impacting them... I know some places had a 3 levels env... like dev/staging/prod. I'd like a setup where I could test things up myself before pushing to the world"
- Boss: "testers, just me for now, but make it so I can have external testers at one point."
- Boss: "oss-lab ... not released so doesn't need dev/staging/prod"

## Q1: How should the staging server for prompts and the API be set up?
**Choices offered:**
- A) Separate service + DB: a second Render service from `next`, its own database, Stripe test mode
- B) Same API, channel switch: production API serves `next` prompts to beta-flagged accounts
- C) Local only for now: DEV only, API on localhost

**Selected: A**: "Separate service + DB (Recommended)"

## Q2: What should the staging server sign prompts with?
**Choices offered:**
- A) Separate staging key; the plugin picks the key by address
- B) Reuse the production key
- C) Skip the signature check on staging

**Selected: A**: "Separate staging key (Recommended)"

## Q3: How does a machine end up on beta (plugin from `next` + staging API + staging key together)?
**Choices offered:**
- A) Version decides (pre-release version defaults to staging)
- B) Config setting `channel` + install from beta marketplace
- C) A `/oss:channel` command

**Answer (other):** "I think a script that (for now) isn't published (since I'm the only tester now that make sense) that takes care of switching modes is good. also, when in STAGING, it should be clear we are working on STAGING. perhaps a banner in the status bar or something..."

## Q4: Where should the unpublished switch script live?
**Choices offered:**
- A) API repo, scripts/
- B) A new private ops repo
- C) Just ~/bin on my machine

**Selected: A**: "API repo, scripts/ (Recommended)"

## Q5: What has to be true before `next` is released to customers?
**Choices offered:**
- A) Your call + a checklist
- B) Checklist + automated smoke
- C) Time-based soak

**Selected: A**: "Your call + a checklist (Recommended)"

## Q6: How should IRON LAW #4 (branch from origin/main) handle `next`?
**Choices offered:**
- A) Repo note, law unchanged
- B) Generalise the law for everyone
- C) Keep main as base

**Selected: A**: "Repo note, law unchanged (Recommended)"

## Design sections
- Section 1 (levels, branches, release checklist, law #4 note): "yes"
- Section 2 (plugin changes; correction: the 101 `URL:` lines are live WebFetch calls, not docs): "sure"
- Section 3 (server, beta marketplace, switch script, order, tests): "yes"
- Stress test F1, F2, F3, U1, T1, all as proposed: "yes"

## Design Decisions Summary
- Fully separate staging (service + DB + Stripe test) so a beta deploy can't touch customers, and external testers are just staging accounts.
- A separate staging signing key picked by address, so the prod private key exists only on prod.
- An unpublished switch script in the private API repo, plus an always-visible STAGING banner driven by the address actually in use.
- One OSS home per channel (`~/.oss` symlink), because hooks, binary and credentials are shared state today.
- The release gate is Boss's judgement plus a checklist. Customers' IRON LAWS are unchanged.
