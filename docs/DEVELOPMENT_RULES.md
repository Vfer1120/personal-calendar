# Development Rules

## Stack contract

- Frontend: React 19, Vite 7, TypeScript, Tailwind CSS 4, FullCalendar, TanStack Query.
- Backend: Hono, Better Auth, Drizzle ORM, PostgreSQL, Zod.
- Offline client: Dexie/IndexedDB.
- Do not add a new framework, database client, state manager, calendar library or UI library without explicit approval.

## Type and validation rules

- Keep TypeScript strict-mode compatibility.
- Reuse schemas and inferred types from `@calendar/domain`.
- Validate request bodies with Zod at the API boundary.
- Do not duplicate domain types inside the frontend.
- Keep date/time values in the existing ISO and timezone conventions.

## API rules

- Every protected route must use `requireAuth`.
- Every workspace-owned query must filter by the authenticated `workspaceId`.
- Reuse the existing item, timetable, settings and sync services.
- Preserve existing error codes and status codes, including conflict and version-conflict responses.
- Do not bypass optimistic version checks.
- Add tests for new endpoints or changed contract behavior.
- Keep Web and other existing clients backward compatible unless a migration plan explicitly says otherwise.

## Frontend rules

- Use the existing `api` / `apiJson` helpers for HTTP calls.
- Keep React Query keys account-scoped; do not leak one user's cache into another user's session.
- Keep offline behavior working: cached reads, queued mutations and post-reconnect sync.
- Do not directly access PostgreSQL, Supabase or S3 secrets from browser code.
- Keep UI copy in the product's direct Chinese style.
- Add loading, empty, error and disabled states consistent with neighboring components.

## Database rules

- Never edit a migration that has already been deployed; add a new numbered migration.
- Test a migration against both an empty database and a database with existing data.
- Preserve existing columns and defaults unless a migration plan explicitly changes them.
- Keep migrations idempotent where the existing migration style supports it.

## Verification gate

Before reporting a task complete, run:

```powershell
pnpm typecheck
pnpm test
pnpm build
```

If the change affects API deployment, also rebuild the bundled Vercel entry when that is part of the project workflow.

For UI changes, manually verify:

- desktop and mobile layout
- light and dark mode
- keyboard/focus behavior
- no console errors
- no unintended change to calendar, timetable, task or settings layout

## Git and secrets

- Never commit `.env`, `.local`, real API keys, database URLs, SMTP credentials, VAPID private keys or attachment keys.
- Do not rewrite shared Git history.
- Do not commit generated test output, screenshots or local caches unless explicitly requested.
- Report all changed files and commands run.
