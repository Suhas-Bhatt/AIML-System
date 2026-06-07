-- supabase/migrations/005_performance_indexes.sql
-- Performance indexes for hot query paths identified in analysis
-- Run: supabase db push  (or apply via Supabase dashboard SQL editor)

-- ─────────────────────────────────────────────────────────────────────
-- sessions table (most queried)
-- ─────────────────────────────────────────────────────────────────────

-- Session status filtering (dashboard stats, session list)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_interview_status
  ON sessions ("interviewId", status);

-- Recent sessions ordering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_created_at_desc
  ON sessions (created_at DESC);

-- Session by participant email (for dedup / tracking)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_participant_email
  ON sessions (participant_email)
  WHERE participant_email IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- messages table (fetched in bulk by summarize route)
-- ─────────────────────────────────────────────────────────────────────

-- The summarize route fetches all messages for a session ordered by timestamp
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_session_timestamp
  ON messages ("sessionId", "timestamp" ASC);

-- Content type filter (fetching only WHITEBOARD or CODE messages)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_session_content_type
  ON messages ("sessionId", "contentType");

-- ─────────────────────────────────────────────────────────────────────
-- violations table (fetched for reports, dashboard logs)
-- ─────────────────────────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_violations_session_timestamp
  ON violations ("sessionId", "timestamp" ASC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_violations_session_severity
  ON violations ("sessionId", severity);

-- ─────────────────────────────────────────────────────────────────────
-- candidates table (invite-only check on session.create — HOT PATH)
-- ─────────────────────────────────────────────────────────────────────

-- This is checked on EVERY session creation for invite-only interviews
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_candidates_interview_email
  ON candidates ("interviewId", email);

-- ─────────────────────────────────────────────────────────────────────
-- interviews table (slug lookup — HOT PATH: candidate page load)
-- ─────────────────────────────────────────────────────────────────────

-- Partial index: only active interviews need fast slug lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_interviews_public_slug_active
  ON interviews ("publicSlug")
  WHERE "isActive" = true;

-- Org-scoped interview listing (dashboard)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_interviews_project_id_active
  ON interviews ("projectId", "isActive", created_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- usage_events table (analytics queries)
-- ─────────────────────────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_events_org_created
  ON usage_events ("organizationId", created_at DESC);
