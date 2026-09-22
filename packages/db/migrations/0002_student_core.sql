ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "auto_rollover" boolean NOT NULL DEFAULT false;
ALTER TABLE "reminder_rules" ADD COLUMN IF NOT EXISTS "trigger" text NOT NULL DEFAULT 'before_start';
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "semester_start_date" date;
