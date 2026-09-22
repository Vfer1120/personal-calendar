ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "timetable_color" text;
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "course_slots" jsonb NOT NULL DEFAULT '[]'::jsonb;