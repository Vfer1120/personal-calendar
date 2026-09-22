CREATE TABLE IF NOT EXISTS "demo_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "token_hash" text NOT NULL UNIQUE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "expires_at" timestamptz NOT NULL,
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "demo_sessions_expires_idx" ON "demo_sessions" ("expires_at");
CREATE INDEX IF NOT EXISTS "demo_sessions_workspace_idx" ON "demo_sessions" ("workspace_id");
