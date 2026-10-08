CREATE TABLE IF NOT EXISTS "timetables" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "semester_start_date" date,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "timetables_workspace_name_idx" ON "timetables" ("workspace_id", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "timetables_workspace_order_idx" ON "timetables" ("workspace_id", "sort_order");

ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "timetable_id" uuid;
ALTER TABLE "schedule_periods" ADD COLUMN IF NOT EXISTS "timetable_id" uuid;

DO $$
DECLARE
  workspace_row record;
  target_timetable uuid;
  inherited_semester date;
BEGIN
  FOR workspace_row IN SELECT id FROM "workspaces" LOOP
    IF EXISTS (SELECT 1 FROM "schedule_periods" WHERE "workspace_id" = workspace_row.id AND "timetable_id" IS NULL)
       OR EXISTS (SELECT 1 FROM "items" WHERE "workspace_id" = workspace_row.id AND "show_in_timetable" = true AND "timetable_id" IS NULL) THEN
      SELECT id INTO target_timetable FROM "timetables" WHERE "workspace_id" = workspace_row.id ORDER BY "sort_order" LIMIT 1;
      IF target_timetable IS NULL THEN
        SELECT "semester_start_date" INTO inherited_semester FROM "app_settings" WHERE "workspace_id" = workspace_row.id;
        INSERT INTO "timetables" ("workspace_id", "name", "sort_order", "semester_start_date")
        VALUES (workspace_row.id, '课表1', 0, inherited_semester)
        RETURNING id INTO target_timetable;
      END IF;
      UPDATE "schedule_periods" SET "timetable_id" = target_timetable WHERE "workspace_id" = workspace_row.id AND "timetable_id" IS NULL;
      UPDATE "items" SET "timetable_id" = target_timetable WHERE "workspace_id" = workspace_row.id AND "show_in_timetable" = true AND "timetable_id" IS NULL;
    END IF;
  END LOOP;
END $$;

ALTER TABLE "schedule_periods" DROP CONSTRAINT IF EXISTS "schedule_periods_workspace_id_sort_order_key";
ALTER TABLE "schedule_periods" DROP CONSTRAINT IF EXISTS "schedule_periods_workspace_order_idx";
CREATE INDEX IF NOT EXISTS "schedule_periods_workspace_idx" ON "schedule_periods" ("workspace_id");
CREATE UNIQUE INDEX IF NOT EXISTS "schedule_periods_timetable_order_idx" ON "schedule_periods" ("timetable_id", "sort_order") WHERE "timetable_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "items_timetable_idx" ON "items" ("timetable_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_timetable_id_fkey') THEN
    ALTER TABLE "items" ADD CONSTRAINT "items_timetable_id_fkey" FOREIGN KEY ("timetable_id") REFERENCES "timetables"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'schedule_periods_timetable_id_fkey') THEN
    ALTER TABLE "schedule_periods" ADD CONSTRAINT "schedule_periods_timetable_id_fkey" FOREIGN KEY ("timetable_id") REFERENCES "timetables"("id") ON DELETE CASCADE;
  END IF;
END $$;