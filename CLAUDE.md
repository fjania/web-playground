# CLAUDE.md

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.

## Plan Mode Default

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

## Subagent Strategy

- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

## Self-Improvement Loop

- After ANY correction from the user: update tasks/lessons.md with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

## Verification Before Done

- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

## Demand Elegance (Balanced)

- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

## Autonomous Bug Fixing

- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests - then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Source Control Practices

### Commits
- Use conventional commit prefixes: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`
- Write in imperative mood, lowercase: `feat: add word cloud palette picker`
- Keep subject line under 72 characters
- One logical change per commit — don't bundle unrelated work

### Branches
- Work on feature branches, not directly on master
- Branch naming: `<type>/<short-description>` (e.g., `feat/portfolio-landing`, `fix/worker-cleanup`)
- Keep branches short-lived — merge or rebase frequently

### Before Committing
- Verify the change works (dev server, visual check, etc.)
- Don't commit generated files (dist/, node_modules/)
- Don't commit secrets or credentials
- Review the diff before staging — no accidental debug code

### PRs
- Keep PRs focused on a single concern
- Include a brief description of what changed and why
- Small, frequent commits — easier to review and revert
