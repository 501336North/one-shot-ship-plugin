# Ideation Q&A Transcript: OS write-sandbox
Date: 2026-11-18
Original prompt: `/oss:ideate OS write-sandbox (R-266 follow-up card, Sprint D, plugin .oss/dev/FOLLOWUPS.md line 359 + the "OS write-sandbox card" addition blocks): run main-agent and builder Bash under a macOS sandbox profile that denies writes to the protected paths, so the OS enforces the rule the tool gate can only approximate by reading shell text; design a Linux fallback. Covers every shell-trick bypass filed since round 15 (ADR-048, ADR-066), the round-22 over-refusals, the `((` over-refusal, and results/ protection (R-257 D22). Feature slug: write-sandbox. Lands on feat/determinism-sprint/build via PR, never main. User scope for now: ideate + plan only, then stop for the user's OK before build.`

## Q1: How should main-agent and builder Bash get OS-enforced protection of the protected paths?
**Choices offered:**
- A) Our Seatbelt wrap + detect CC's (Recommended)
- B) Configure Claude Code's sandbox
- C) Recommend CC's sandbox, don't wrap

**Selected: A**: "Our Seatbelt wrap + detect CC's (Recommended)"

## Q2: Once a call runs inside the write sandbox, what happens to the text gate's write-path refusals?
**Choices offered:**
- A) OS decides protected paths (Recommended)
- B) Keep both layers
- C) Loosen only the filed ones

**Selected: A**: "OS decides protected paths (Recommended)"

## Q3: On macOS, what happens when the write sandbox can't be trusted?
**Choices offered:**
- A) Text gate + one notice (Recommended)
- B) Refuse, like review agents

**Selected: A**: "Text gate + one notice (Recommended)"

## Q4: What does Linux (and WSL2) get?
**Choices offered:**
- A) Text gate now, bwrap card (Recommended)
- B) Build bwrap in this card

**Selected: A**: "Text gate now, bwrap card (Recommended)"

## Q5: Which protected paths should the OS deny?
**Choices offered:**
- A) OS: code-run + gate config (Recommended)
- B) OS: the whole list

**Selected: A**: "OS: code-run + gate config (Recommended)"

## Q6: Design part 1 (call flow): is it right?
**Answer:** "yes"

## Q7 (stress test): How should the write sandbox treat git config?
**Choices offered:**
- A) Git-only calls unwrapped (Recommended); husky's npm install setup becomes a new allowed→refused case, shown by the served-command BEFORE/AFTER run
- B) Leave git config to the text gate
- C) Deny git config everywhere

**Selected: A**: "Git-only calls unwrapped (Recommended)"

## Q8 (stress test): Hard links made before the session, sandbox-exec deprecation, per-call cost
**Choices offered:**
- A) Accept all three (Recommended)
- B) Discuss one first

**Selected: A**: "Accept all three (Recommended)"

## Q9 (after a heads-up during requirements): How should the text gate treat unreadable targets inside the sandbox? (refines Q2)
**Choices offered:**
- A) Narrow the loosening (Recommended)
- B) No loosening (both layers)
- C) OS-deny those files too

**Selected: A**: "Narrow the loosening (Recommended)"

## Design Decisions Summary
- Plugin-controlled Seatbelt write-deny wrap for the main agent and builders. Claude Code's own sandbox counts only if it covers the deny set and can't be bypassed.
- Inside the wrap, the OS decides protected paths, which ends the text gate's over-refusals.
- Fallback everywhere else is today's text rules plus one notice. Linux bubblewrap is a separate card.
- The deny set is code-run and gate-config paths. Refs, HEAD and workflow-state stay with the text gate.
- Git-only calls stay unwrapped, so git config writes from git itself keep working. Husky's `git config` inside a non-git call becomes refused, which the user accepted.
