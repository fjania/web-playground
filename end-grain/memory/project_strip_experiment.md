---
name: Strip experiment working log (#49)
description: GitHub issue #49 is the rolling log for the 3d-experiment harness — strip model, face identity, mating R&D. Post comments there as insights land.
type: project
---

GitHub issue **#49** ("Experiment: Strip model + mating R&D (3d-experiment harness)") is the working log for the `3d-experiment.html` harness. It contains:
- Goals of the experiment (what we're working out).
- Principles uncovered so far (durable findings, same format as #45 but scoped to this line of work).
- A log section that grows via comments as new insights land.

**Why:** The harness is where the real `Strip` data model and mating algorithms are being designed — not a sketch. #49 keeps the trail across inevitable context clears so future sessions can pick up without rereading the transcript. Principles will fold into #45 once they stabilize.

**How to apply:**
- When a new insight lands during work on this harness (a model-shape decision, a surprise from manifold, a UX rule we chose, a constraint the domain imposes), post a comment on #49 summarizing it. Keep comments tight — one insight per comment, enough context that a cold reader gets it.
- When starting a session that involves `3d-experiment.html`, `Strip.ts`, or mating work, check #49 first.
- When a principle from #49 has proven stable (used across multiple sessions without revision), move it into #45.
