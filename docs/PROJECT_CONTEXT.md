# Personal Calendar Project Context

## Current baseline

- Git repository: `https://github.com/Vfer1120/personal-calendar`
- Primary branch: `master`
- Production frontend: `https://personal-calendar-cz9.pages.dev`
- Production API upstream: configured in `worker/index.mjs`
- Database and attachments: Supabase production resources
- Current priority: maintain and continue the existing Web/PWA project
- WeChat Mini Program: future work, not part of the current implementation phase

## Product summary

Personal Calendar is a mobile-first calendar, task, timetable, reminder, and AI import application. It supports offline use as a PWA, multi-user workspaces, recurring schedules, course timetables, attachments, Web Push, and AI text/image extraction.

## Architecture

- `apps/web`: React 19 + Vite 7 + TypeScript PWA. Main UI, FullCalendar views, task panel, course timetable, settings, AI import, offline cache, PWA installation.
- `apps/api`: Hono API with Better Auth, Drizzle ORM, Zod, PostgreSQL, S3-compatible attachments, AI provider integration, sync, reminders and review endpoints.
- `apps/worker`: background worker for reminder delivery, subscription refresh, cleanup, and encrypted backups.
- `packages/domain`: pure TypeScript domain logic and schemas, including recurrence, conflicts, ICS/CSV, course slots and timetable rules.
- `packages/db`: Drizzle schema, database client, and SQL migrations `0000` through `0007`.
- `worker/index.mjs`: Cloudflare Pages Worker. Forwards `/api/*` to the Vercel API and serves static assets for all other paths.
- `api/[...route].js`: bundled Vercel API entry. Rebuild this only when the task requires updating the deployed API bundle.

## Current production data flow

1. Browser loads the PWA from Cloudflare Pages.
2. Browser calls same-origin `/api/*`.
3. Cloudflare Pages Worker forwards the request to the configured Vercel API origin.
4. Vercel API uses PostgreSQL for business data and Supabase Storage for encrypted attachments.
5. Supabase Cron calls protected internal API endpoints for reminders, subscriptions, and cleanup.

## Main features

- Calendar views: day, week, month, agenda, course timetable, navigation and responsive mobile behavior.
- Items: event, task, event + task, all-day, start/end/due time, location, notes, priority, tags, status and subtasks.
- Recurrence: daily, weekly, monthly, yearly, custom intervals, odd/even weeks and single-occurrence overrides.
- Timetable: multiple timetable pages, editable periods, course slots, colors, date ranges, conflict display, fixed headers and mobile horizontal scrolling.
- AI import: long text and up to three images, structured draft preview, edit/delete drafts, duplicate warning, batch import through the existing item API.
- Reminders and reviews: start reminders, end confirmation, snooze, rollover suggestions, batch review, in-app notifications and Web Push.
- Offline: account-scoped IndexedDB cache, outbox, incremental sync, recovery merge and offline session.
- Attachments: AES-256-GCM encryption, Supabase Storage direct upload, preview and download.
- Authentication and multi-user: Better Auth, email OTP, username/password, passkey, invite code and workspace isolation.
- PWA: standalone display, icons, manifest, persistent storage, service worker and installation flow.

## Important API groups

- `/api/auth/*`: Better Auth endpoints, including email OTP, password and passkey.
- `/api/v1/bootstrap`: setup and instance capability information.
- `/api/v1/me`: current authenticated user and workspace.
- `/api/v1/items`: item CRUD, bulk operations, occurrences, exceptions, rollover and resolution.
- `/api/v1/timetables`: timetable pages and periods.
- `/api/v1/schedule-periods`: legacy-compatible period access.
- `/api/v1/settings`: theme, default view, semester date, reminder sound and ICS token.
- `/api/v1/tags`: tag CRUD.
- `/api/v1/sync`: push and pull synchronization.
- `/api/v1/ai`: AI status, temporary uploads and extraction.
- `/api/v1/reminders`, `/api/v1/reviews`: reminders, deliveries and missed-item review.
- `/api/v1/attachments`: encrypted attachment upload, finalize, download and delete.
- `/api/v1/exchange`: JSON/CSV/ICS import and export.
- `/api/v1/subscriptions`, `/api/v1/ics`: external calendar subscriptions and public ICS.

## Database migrations

The current schema is built by these files in order:

1. `0000_init.sql`
2. `0001_demo_sessions.sql`
3. `0002_student_core.sql`
4. `0003_ai_usage.sql`
5. `0004_course_timetable.sql`
6. `0005_course_slots.sql`
7. `0006_course_date_range.sql`
8. `0007_timetable_pages.sql`

Do not edit an already deployed migration to change existing behavior. Add a new numbered migration instead.

## Local development

- Node.js 22 and pnpm `9.15.5`.
- Standard local mode can use Docker Compose for PostgreSQL and MinIO.
- The current development machine may also have a portable runtime under `%LOCALAPPDATA%\PersonalCalendar`.
- For isolated AI development on this machine, use a separate database such as `calendar_dev`, not the private `calendar` database.
- API normally runs on `http://localhost:3000` and Web on `http://localhost:5173`.
- Do not use production `DATABASE_URL` or production `S3_*` for local testing.

## Commands

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm dev
```

## Known project constraints

- Preserve the current orange accent, warm neutral surfaces, rounded cards, soft borders and dark-mode behavior.
- Do not introduce a new UI framework or state-management library.
- Keep existing API response shapes backward compatible.
- Keep account and workspace isolation on every protected route.
- Web Push, Service Worker and PWA behavior are sensitive; test them before changing.
- The Cloudflare Pages Worker currently contains the Vercel API origin. If the cloud account or API project changes, update it and redeploy Pages.
