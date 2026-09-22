CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE TABLE IF NOT EXISTS "user" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "email_verified" boolean NOT NULL DEFAULT false,
  "image" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "session" (
  "id" text PRIMARY KEY,
  "expires_at" timestamptz NOT NULL,
  "token" text NOT NULL UNIQUE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "ip_address" text,
  "user_agent" text,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS "account" (
  "id" text PRIMARY KEY,
  "account_id" text NOT NULL,
  "provider_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "access_token" text,
  "refresh_token" text,
  "id_token" text,
  "access_token_expires_at" timestamptz,
  "refresh_token_expires_at" timestamptz,
  "scope" text,
  "password" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "verification" (
  "id" text PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "passkey" (
  "id" text PRIMARY KEY,
  "name" text,
  "public_key" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "credential_id" text NOT NULL UNIQUE,
  "counter" integer NOT NULL DEFAULT 0,
  "device_type" text NOT NULL,
  "backed_up" boolean NOT NULL DEFAULT false,
  "transports" text,
  "aaguid" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "workspaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "name" text NOT NULL DEFAULT '我的日程',
  "timezone" text NOT NULL DEFAULT 'Asia/Shanghai',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "calendars" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "color" text NOT NULL DEFAULT '#f97316',
  "kind" text NOT NULL DEFAULT 'local',
  "timezone" text NOT NULL DEFAULT 'Asia/Shanghai',
  "is_visible" boolean NOT NULL DEFAULT true,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "calendars_workspace_idx" ON "calendars" ("workspace_id");
CREATE TABLE IF NOT EXISTS "tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "color" text NOT NULL DEFAULT '#64748b',
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "tags_workspace_name_idx" ON "tags" ("workspace_id", "name");
CREATE TABLE IF NOT EXISTS "items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "calendar_id" uuid REFERENCES "calendars"("id") ON DELETE SET NULL,
  "parent_id" uuid,
  "kind" text NOT NULL DEFAULT 'event',
  "title" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "location" text NOT NULL DEFAULT '',
  "start_at" timestamptz,
  "end_at" timestamptz,
  "due_at" timestamptz,
  "is_all_day" boolean NOT NULL DEFAULT false,
  "timezone" text NOT NULL DEFAULT 'Asia/Shanghai',
  "priority" text NOT NULL DEFAULT 'none',
  "status" text NOT NULL DEFAULT 'active',
  "completed_at" timestamptz,
  "recurrence" jsonb,
  "search_text" text NOT NULL DEFAULT '',
  "version" integer NOT NULL DEFAULT 1,
  "deleted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "items_workspace_start_idx" ON "items" ("workspace_id", "start_at");
CREATE INDEX IF NOT EXISTS "items_workspace_status_idx" ON "items" ("workspace_id", "status");
CREATE INDEX IF NOT EXISTS "items_parent_idx" ON "items" ("parent_id");
CREATE INDEX IF NOT EXISTS "items_search_trgm_idx" ON "items" USING gin ("search_text" gin_trgm_ops);

CREATE TABLE IF NOT EXISTS "recurrence_exceptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE CASCADE,
  "occurrence_key" text NOT NULL,
  "action" text NOT NULL,
  "override" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "recurrence_exception_item_key_idx" ON "recurrence_exceptions" ("item_id", "occurrence_key");

CREATE TABLE IF NOT EXISTS "item_tags" (
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE CASCADE,
  "tag_id" uuid NOT NULL REFERENCES "tags"("id") ON DELETE CASCADE,
  PRIMARY KEY ("item_id", "tag_id")
);

CREATE TABLE IF NOT EXISTS "reminder_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE CASCADE,
  "offset_minutes" integer NOT NULL,
  "channels" jsonb NOT NULL DEFAULT '["in_app"]'::jsonb,
  "repeat_every_minutes" integer,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "reminder_rules_item_idx" ON "reminder_rules" ("item_id");

CREATE TABLE IF NOT EXISTS "attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE CASCADE,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "size" integer NOT NULL,
  "object_key" text NOT NULL,
  "iv" text NOT NULL,
  "auth_tag" text NOT NULL,
  "wrapped_key" text NOT NULL,
  "sha256" text NOT NULL,
  "thumbnail_key" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "attachments_item_idx" ON "attachments" ("item_id");
CREATE INDEX IF NOT EXISTS "attachments_workspace_idx" ON "attachments" ("workspace_id");
CREATE TABLE IF NOT EXISTS "deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE CASCADE,
  "rule_id" uuid REFERENCES "reminder_rules"("id") ON DELETE SET NULL,
  "occurrence_key" text NOT NULL,
  "scheduled_at" timestamptz NOT NULL,
  "channel" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "attempt" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamptz,
  "delivered_at" timestamptz,
  "acknowledged_at" timestamptz,
  "snoozed_until" timestamptz,
  "last_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "deliveries_idempotency_idx" ON "deliveries" ("rule_id", "occurrence_key", "channel", "scheduled_at");
CREATE INDEX IF NOT EXISTS "deliveries_due_idx" ON "deliveries" ("status", "scheduled_at");
CREATE INDEX IF NOT EXISTS "deliveries_workspace_idx" ON "deliveries" ("workspace_id");

CREATE TABLE IF NOT EXISTS "external_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "calendar_id" uuid REFERENCES "calendars"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "url" text NOT NULL,
  "color" text NOT NULL DEFAULT '#0ea5e9',
  "refresh_minutes" integer NOT NULL DEFAULT 15,
  "etag" text,
  "last_modified" text,
  "last_fetched_at" timestamptz,
  "last_error" text,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "subscriptions_workspace_idx" ON "external_subscriptions" ("workspace_id");

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "endpoint" text NOT NULL UNIQUE,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_agent" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "last_seen_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "sync_mutations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "client_mutation_id" text NOT NULL,
  "entity" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "action" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "result" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "sync_mutations_client_idx" ON "sync_mutations" ("workspace_id", "client_mutation_id");

CREATE TABLE IF NOT EXISTS "change_log" (
  "id" bigserial PRIMARY KEY,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "entity" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "operation" text NOT NULL,
  "version" integer NOT NULL,
  "payload" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "change_log_workspace_id_idx" ON "change_log" ("workspace_id", "id");

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" bigserial PRIMARY KEY,
  "workspace_id" uuid REFERENCES "workspaces"("id") ON DELETE SET NULL,
  "actor_id" text,
  "action" text NOT NULL,
  "entity" text,
  "entity_id" text,
  "metadata" jsonb,
  "ip_address" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "audit_logs_workspace_idx" ON "audit_logs" ("workspace_id", "created_at");

CREATE TABLE IF NOT EXISTS "app_settings" (
  "workspace_id" uuid PRIMARY KEY REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "theme" text NOT NULL DEFAULT 'system',
  "default_view" text NOT NULL DEFAULT 'responsive',
  "default_reminder_minutes" integer NOT NULL DEFAULT 15,
  "default_reminder_channels" jsonb NOT NULL DEFAULT '["in_app", "browser_push"]'::jsonb,
  "week_starts_on" integer NOT NULL DEFAULT 1,
  "ics_token" text NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);