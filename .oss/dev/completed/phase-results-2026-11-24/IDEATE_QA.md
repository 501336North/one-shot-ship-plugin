# Ideation Q&A Transcript: phase-results (R-257)
Date: 2026-11-13
Original prompt: `/oss:ideate`

Context: the user ran `/oss:ideate` with no arguments. The topic was set by the coordinator's assignment (R-257, Sprint D) and the provenance survey: /private/tmp/claude-501/-Users-ysl-dev/d42aa2d9-ec5e-420e-ad83-58e63cad8053/scratchpad/r257-provenance-survey.md.

## Q1: Who writes each phase's JSON result?
**Choices offered:**
- A) Code-assembled (Recommended): code builds the result from evidence (recorder events, review-agent output, git); the model adds only free text.
- B) Model-written + validated.
- C) Hybrid per phase.

**Selected: A**: Code-assembled (Recommended)

## Q2: How should the card be sliced?
**Choices offered:**
- A) Slice A now, B later (Recommended): A is new files only; B (per-task green after the last production edit) waits for R-266.
- B) Whole card at once.
- C) A only, B to a new card.

**Selected: A**: Slice A now, B later (Recommended)

## Q3: oss-lab side: where does the pass:true-only ship-verdict fix go?
**Choices offered:**
- A) In R-257, after plugin A (Recommended).
- B) Separate oss-lab card.
- C) In R-257, same PR wave.

**Selected: A**: In R-257, after plugin A (Recommended)

## Q4: What does "a missing or malformed result fails the phase" do in the plugin?
**Choices offered:**
- A) Complete refuses + Stop blocks (Recommended).
- B) Complete refuses only.
- C) Warn mode first.

**Selected: A**: Complete refuses + Stop blocks (Recommended)

## Q5: How are the phase schemas written and checked?
**Choices offered:**
- A) Plugin JSON Schema + tiny validator (Recommended).
- B) Add ajv to the watcher.
- C) jq rules like oss-timeline.

**Selected: A**: Plugin JSON Schema + tiny validator (Recommended)

## Q6: Where do ship's per-gate verdicts and findings come from?
**Choices offered:**
- A) Agent JSON block, staged (Recommended): timeline gate lines until R-266 merges, then SubagentStop capture.
- B) Timeline gate lines only.
- C) Wait for R-266 first.

**Selected: A**: Agent JSON block, staged (Recommended)

## Q7: Which prose-reading sites does R-257 replace?
**Choices offered:**
- A) Decision sites only (Recommended).
- B) Every site, including metrics.
- C) Gates only, archive later.

**Selected: A**: Decision sites only (Recommended)

## Q8: Design section 1 (shape and flow): does it look right?
**Selected:** Looks right (Recommended)

## Q9: Design section 2 (components, held items): does it look right?
**Selected:** Looks right (Recommended)

User heads-up during section 2 (exact text): "Both the end-of-session block and the review-agent capture you picked need a hook-settings file that R-266 is still changing, so neither can switch on until R-266 merges." This became stress-test concern 1.

## Q10: Stress test 1: the R-266 gap (hooks.json frozen; only complete refuses until then)
**Choices offered:**
- A) Accept, wire on rebase (Recommended).
- B) Hold the slice A merge.

**Selected: A**: Accept, wire on rebase (Recommended)

## Q11: Stress test 2: misfiled decision records (the hook resolves the feature from the session start folder)
**Choices offered:**
- A) Fix resolution in slice A (Recommended).
- B) Separate card.

**Selected: A**: Fix resolution in slice A (Recommended)

## Q12: Stress test 3: how plan's tasks reach the result
**Choices offered:**
- A) Model value file, validated (Recommended).
- B) Parse the PLAN.md table.

**Selected: A**: Model value file, validated (Recommended)

## Q13: Stress test 4: how the overrider is recorded
**Choices offered:**
- A) Decision record id (Recommended).
- B) git config user.name.

**Selected: A**: Decision record id (Recommended)

## Design Decisions Summary
- Results are built by code from evidence, with each field's source recorded. The model supplies only free text, plus plan's task list (validated).
- Slice A now. Slice B and the hooks.json wiring follow after R-266 merges. oss-lab's reader comes after plugin slice A.
- `oss-notify complete` refuses a missing or invalid result. One Stop dispatcher (ADR-1) blocks; R-265 extends it.
- The JSON Schema files in the plugin are the single source, checked by a keyword-subset validator. The API's unused schemas are retired.
- The decision-hook repo resolution is fixed in slice A (user pick D10). The coordinator suggested FOLLOWUPS instead; the user's pick stands.
- Overrides point to the hook-written decision record; no model-written names.
