-- supabase/migrations/007_violations_table.sql
-- CRITICAL MISSING MIGRATION
-- The violations table does NOT exist in 001_initial_schema.sql
-- but the Python proctoring server tries to POST to /rest/v1/violations
-- and the frontend references session violations.
-- This migration creates it.

CREATE TABLE IF NOT EXISTS violations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId"     uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  type            text NOT NULL,
  severity        text NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'WARNING', 'LOW')),
  timestamp       timestamptz NOT NULL DEFAULT now(),
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  event_count_in_window int NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_violations_session_id
  ON violations ("sessionId");

CREATE INDEX IF NOT EXISTS idx_violations_session_timestamp
  ON violations ("sessionId", timestamp ASC);

CREATE INDEX IF NOT EXISTS idx_violations_severity
  ON violations ("sessionId", severity);

-- Row Level Security
ALTER TABLE violations ENABLE ROW LEVEL SECURITY;

-- Drop policies if they exist (for robustness on retry)
DROP POLICY IF EXISTS "service_role_all" ON violations;
DROP POLICY IF EXISTS "recruiter_read" ON violations;

-- Service role can do everything (used by proctoring server)
CREATE POLICY "service_role_all" ON violations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated users (recruiters) can read violations for their org's sessions
CREATE POLICY "recruiter_read" ON violations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM sessions s
      JOIN interviews i ON i.id = s."interviewId"
      JOIN projects p ON p.id = i."projectId"
      JOIN organization_members om ON om."workspaceId" = p."organizationId"
      WHERE s.id = violations."sessionId"
        AND om."userId" = auth.uid()
    )
  );

COMMENT ON TABLE violations IS 'Proctoring violations detected by the Python CV server during interview sessions. Synced from the Python proctoring server via Supabase REST API. Also used by frontend anti-cheating (browser-based) events via the session router.';

