# CLAUDE.md

This repo is a personal exploration sandbox. Everything in here is experimental — interactive essays, focused harnesses for geometric operations, research spikes, early-stage projects. The artifacts aren't being shipped to consumers; they're being built to learn. Treat every task as exploration.

## How we work

### Exploration is the default

Plans here don't come from specs. They come from making something, looking at it, reacting. The productive loop is:

1. Build a minimal thing.
2. Show it (screenshot, render, run).
3. React.
4. Commit before the next attempt so the trail is recoverable.
5. Repeat until the thing is right.

This looks like "fast iteration." It's really slow-motion discovery: each cycle teaches something the previous one couldn't articulate.

### Focused harnesses

For any non-trivial concept, build a **focused harness**: one constrained page or script with URL-param-driven configuration, renderable in isolation, with every knob the concept supports surfaced as a parameter. Other concepts don't leak in. The constraint is what makes iteration effective — it keeps the working context tight enough to reason about.

If you find yourself adding features to an existing page to test a new concept, stop. Spin up a separate harness instead.

### Snapshot-is-truth

If one layer produces data and another renders it, the renderer reads from the data. It does **not** re-derive the data from whatever parameters the producer was given. Otherwise the two silently drift and debugging becomes a two-place problem.

### Scaffolding is real work

Extracting shared modules, adding URL-param machinery, writing a test sweep, building a harness — these cost lines of code but earn their keep if they make subsequent iteration faster. Count them as progress, not over-engineering.

Test: does this scaffolding enable faster iteration on the artifact? If yes, keep going. If no, it's bike-shedding.

## When to enter plan mode

Rarely. Exploration mode thrives on the build–look–react loop; a plan injected mid-loop kills the feedback.

Do enter plan mode when:
- The user asks for a proposal or design doc.
- A task requires cross-cutting changes across many files of unfamiliar code.
- The user has pushed back three times on fundamental framing — that's a signal the problem isn't well-understood and a plan is needed before more code.

Otherwise: just build. If something goes sideways, **STOP and re-plan immediately** — don't keep pushing.

## Context budget

Main context is a finite resource. Protect it:

- **Grep before Read.** Use Glob / Grep with `files_with_matches` for initial survey. Only Read the files actually needed to edit or cite.
- **Read with offset + limit** when only part of a large file matters.
- **Subagent dispatch thresholds:**
  - Grep-then-read across more than ~5 files → subagent.
  - Reading unfamiliar code in a module you won't modify → subagent.
  - Researching library options / API alternatives → subagent.
  - Multi-step verification across many URLs → subagent.
  - **Verification sweeps** — after a type or API change, "does every consumer handle this?" across many files → subagent.
  - **Bulk tool-output processing** — DOM dumps, test logs, CI output where the raw result is large and only a conclusion matters → subagent.
- **Narrow tool-result returns.** When `evaluate_script` / `curl` / similar returns data, ask for the boolean or string you actually need — not the whole payload. `{ hasX: true }` beats a 10 KB DOM dump. If you need to inspect a large result, do it in a subagent.
- **Screenshot dimension discipline.** Before `take_screenshot`, resize the viewport to ≤1200×800 so the image can't exceed the 2000-px many-image-request limit. Prefer `take_snapshot` (DOM / a11y tree) for verifying state; reserve screenshots for visual-feel checks. Never `fullPage: true` without checking the page is short — a single oversized screenshot has nuked entire conversations.
- **Spawn tasks** (via session spawn tools) for out-of-scope items noticed mid-flight, rather than expanding the current conversation to cover them.
- **Mark chapters** at natural boundaries (concept → concept, implementation → verification) so the transcript has navigable structure and future compaction has clean break points.

If the user says "context is getting full" — that's a process bug. A subagent should have been dispatched earlier.

## Session continuity

Compaction is lossy — when the runtime compacts the conversation to fit, subtle reasoning and specific code references get flattened into a summary. Design the session so compaction hurts less:

- **GitHub issues as checkpoints.** At phase boundaries (a branch merges, a design decision lands, a line of investigation closes), post a short session-digest issue: what was decided, what shipped, what's still in flight, what's next. Future-you (or a colleague cold-opening the project) reads the issue, not the conversation. See #38 and #43 for the pattern. Principles durable enough to outlast the current phase belong in #45 (Core Principles) instead.
- **Prefer `/clear` over drifting into compaction.** When a phase is done, committed, and digested to an issue, start fresh. Durable state — code, issues, memory, plans — carries forward intact. Compaction, by contrast, interprets everything through a lossy summary.
- **Commit messages as session history.** Tight `Prompt:` trailers make `git log` a readable transcript. Post-compaction you can rebuild "what we decided and why" from the log without rereading the conversation.

## Deferred rough edges

Exploration intentionally leaves rough edges — dead ends we chose not to fix now, known gaps we want to see, intentional debug surfaces. That's fine in principle. But it has a hard rule:

**Every deferred rough edge must (a) become a GitHub issue AND (b) be flagged to the user explicitly at the moment of deferral.**

No silent tech debt. No `// TODO: come back to this` in a code comment with no corresponding issue.

When deferring something:
1. Say so clearly in the current response, in plain English, not buried in a list.
2. Offer to file an issue via `gh issue create`. Don't wait for permission — propose the issue body and ask for sign-off.
3. Once the issue exists, reference its number in any in-code TODO.
4. Commit the deferral with a message that names the issue.

## Self-improvement loop

When the user corrects a **mental model** — not a typo, not a preference, but a model of how something works — capture the lesson. Goal is to prevent the *class* of mistake, not to log every micro-correction.

Lessons live in two places:

### User-level: `~/.claude/projects/.../memory/`
Workflow lessons. How the user iterates. What kinds of feedback they tend to give. Conventions that apply across every project in the repo. Anything that transcends a single domain.

Persists across sessions. Not visible to collaborators (it's in the user's home, not the repo).

### Project-level: `<project>/memory/` (committed to the repo)
Domain lessons specific to one project — its invariants, its physics, its user-facing vocabulary. Things a future collaborator opening the project cold should know.

Visible in git history. Shareable across worktrees.

### Which layer?

Ask: does this lesson apply to **every project** in the repo — or only to this one?

- Applies everywhere → user-level.
- Applies only to this project's domain → project-level.

If unsure, ask the user. Don't guess.

### Keeping lessons healthy

- Prefer one broad lesson over many narrow ones.
- If the same class of mistake reappears after a lesson has been filed, the lesson is too weak. Rewrite it.
- Review relevant lessons at the start of a session on a project.

## Source control

### Commit on every change
- Every code change, committed. No uncommitted work across user turns.
- One logical change per commit. No bundling.
- Commit *before* trying something that might not work, so the pre-attempt state is recoverable.
- Only exception: the user explicitly says "don't commit yet."

### Commit message format
Every commit must include:

1. **Technical description** of what changed and why.
2. **The prompt that triggered the change**, verbatim (or lightly trimmed) in a `Prompt:` line.

Format:

```
<type>: <short imperative subject, under 72 chars>

<technical description of what changed and why>

Prompt: <user's prompt, verbatim or lightly trimmed>

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

Prefixes: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`. Lowercase imperative subject. Under 72 chars.

### Push after every commit
The exploration trail needs to be visible on GitHub, not just local. On a branch with no upstream: `git push -u origin <branch>`.

### Branches
- Feature branches, never master directly.
- `<type>/<short-description>` (e.g., `feat/portfolio-landing`, `fix/worker-cleanup`).
- Short-lived — merge or rebase frequently.

### Before committing
- Verify the change works (dev server, screenshot, test pass).
- Don't commit generated files (`dist/`, `node_modules/`), secrets, or accidental debug code.

## Verification before done

- Never call a task complete without demonstrating it works.
- Run tests. Take the screenshot. Check the console for errors. Diff behaviour against pre-change state when relevant.
- Ask: "would a staff engineer approve this?" — keeping in mind this is exploration, so the bar is "correct and reproducible," not "production-hardened."

## Demand elegance (balanced)

For non-trivial changes, pause and ask: "is there a more elegant way?" If a fix feels hacky, rewrite it cleanly before committing.

Skip this for obvious one-line fixes — don't over-engineer small stuff.

## Autonomous bug fixing

Given a bug report, just fix it. Point at logs, errors, failing tests — then resolve them. Zero context switching for the user. Fix failing CI without being told how.
