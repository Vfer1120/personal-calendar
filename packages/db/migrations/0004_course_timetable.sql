ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "show_in_timetable" boolean NOT NULL DEFAULT false;
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "reminder_sound_enabled" boolean NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS "schedule_periods" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "start_time" text NOT NULL,
  "end_time" text NOT NULL,
  "sort_order" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("workspace_id", "sort_order")
);
CREATE INDEX IF NOT EXISTS "schedule_periods_workspace_idx" ON "schedule_periods" ("workspace_id");