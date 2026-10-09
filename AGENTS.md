# AI Development Guide

This repository is the Personal Calendar Web/PWA project. AI contributors must read these files before changing code:

1. `docs/PROJECT_CONTEXT.md`
2. `docs/UI_STYLE_GUIDE.md`
3. `docs/DEVELOPMENT_RULES.md`
4. `docs/AI_COLLABORATION.md`
5. `docs/MIGRATION_HANDOFF.md`

## Current priority

- First: understand and maintain the existing Web/PWA project.
- WeChat Mini Program work is deferred until explicitly approved.
- Do not add `apps/wechat` or change authentication for Mini Program without an approved task.

## Hard rules

- Do not change the framework stack, design language, or main dependencies without approval.
- Preserve existing UI style, layout, responsive behavior, and dark mode.
- One writer at a time. Do not edit while another AI is editing the same workspace.
- Never commit `.env`, `.local`, secrets, database URLs, API keys, or attachment keys.
- Use `pnpm` and respect the workspace scripts.
- Run `pnpm typecheck`, `pnpm test`, and the relevant build before reporting completion.
- Report changed files, commands run, test results, and remaining risks.
