# Ideation Q&A Transcript: complete-gaps
Date: 2026-11-27
Original prompt: `/oss:ideate complete-gaps: FOLLOWUPS cards 1+2 from phase-results (R-257). (1) archive-before-merge: ship complete refused after the served ship step archives dev docs; (2) no legacy path at complete: a pre-R-257 feature mid-phase can never complete (no_run_started). Both block Sprint D→main.`

## Q1: Scope. The refusals came from a mixed install (R-257 hooks in the real ~/.oss/hooks from the 11-24 clean-copy run, with the 2.2.x wrapper and main-served prompts). Under a consistent Sprint D install, archive → merge → complete already works (D84-D86). The remaining gaps are (a) build complete after the archive (a fix round) refusing no_feature, and (b) a ship in flight across the plugin upgrade. What scope for complete-gaps?
**Choices offered:**
- A) Narrow to (a)+(b) (Recommended): correct cards 1 and 2; build/plan complete use the same archived lookup as ship; a legacy run gets a D17-style notice at complete; prove it first with an acceptance test of the real Sprint D flow
- B) Verify only, no code: add the acceptance test; close cards 1 and 2 if it passes; (b) becomes an upgrade note
- C) Keep original cards: archive only after complete, plus a legacy rule at complete for every phase

**Selected: A** — "Narrow to (a)+(b) (Recommended)"

## Q2: For gap (b), a ship in flight when the plugin upgrades to Sprint D (no run row, no results in the repo or the ledger), what should complete do?
**Choices offered:**
- A) Pass + mark unverified (Recommended): a D17-style notice, the phase recorded unverified (as ADR-1 does), and the chain runs
- B) Pass with notice only
- C) Refuse, say re-run: a clear hint to run /oss:<phase> again under the new plugin

**Selected: A** — "Pass + mark unverified (Recommended)"

## Design Decisions Summary
- Cards 1 and 2 were partly a misdiagnosis: the root cause was a mixed install. Scope is narrowed to the two real gaps.
- (a) The D84 archived-folder lookup also covers build; the ship-only merge proof stays ship-only.
- (b) A legacy run (no run row, no results anywhere) passes complete with a notice and is marked unverified, never verified.
- The guard against test runs writing to the real ~/.oss widens card 3. The leftover hook files wait for the owner.
