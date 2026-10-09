# AI Collaboration Guide

## Roles

- Codex: architecture, data model, API contracts, security, difficult debugging and final review.
- CodeBuddy: implementation in the shared workspace after receiving an approved task and reading the project documents.

## Current phase

- Priority: migrate and preserve the existing Web/PWA project knowledge.
- WeChat Mini Program development is deferred. Do not add `apps/wechat` or change authentication for it until a new task explicitly authorizes that phase.

## Workflow

1. Ask mode: read the repository and report facts without modifying files.
2. Planning: identify files, interfaces, migrations and tests before editing.
3. Approval: Codex reviews the plan and locks the scope.
4. Craft mode: one writer implements the task.
5. Verification: run typecheck, tests, build and relevant browser checks.
6. Review: Codex reviews the diff and decides whether the task is complete.

## One-writer rule

- Only one AI may edit the workspace at a time.
- Before starting a task, check `git status --short`.
- If there are unexpected changes, stop and report instead of overwriting them.
- Do not run migrations, installs, formatters or builds concurrently in two workspaces that point to the same development database.

## Reporting format

Every implementation report must contain:

- Task completed
- Files changed
- Database migrations added
- Commands run
- Test/build results
- Manual verification performed
- Known limitations or follow-up risks

## Context files to read

Read in this order before changing code:

1. `AGENTS.md`
2. `docs/PROJECT_CONTEXT.md`
3. `docs/UI_STYLE_GUIDE.md`
4. `docs/DEVELOPMENT_RULES.md`
5. `docs/MIGRATION_HANDOFF.md`

## Change discipline

- Keep changes scoped to the approved task.
- Do not refactor unrelated files.
- Preserve public API shapes and existing UI style.
- Prefer extending existing patterns over creating parallel abstractions.
- When uncertain, stop and ask rather than guessing at product behavior.
