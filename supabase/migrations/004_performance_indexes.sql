-- Migration 004: Performance Optimization Indexes
-- VERIFIED against 001_initial_schema.sql (camelCase quoted identifiers).
-- Only indexes columns that actually exist. All statements are idempotent.
--
-- Targets the real hot paths observed in the tRPC routers:
--   * interview.dashboardStats  -> sessions/questions/messages filtered by interviewId
--   * interview list            -> interviews filtered by projectId / userId
--   * session lookups           -> messages by sessionId, candidates by sessionId
--
-- NOTE: This project stores anti-cheating violations as a JSONB column
-- (sessions."antiCheatingLog" / "activitySegments"), NOT a separate table,
-- so there is no violations/answers/activity_log table to index.

------------------------------------------------------------------------
-- interviews
------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_interviews_projectId
  ON interviews("projectId");

CREATE INDEX IF NOT EXISTS idx_interviews_userId
  ON interviews("userId");

CREATE INDEX IF NOT EXISTS idx_interviews_publicSlug
  ON interviews("publicSlug");

-- Common composite: list active interviews in a project, newest first
CREATE INDEX IF NOT EXISTS idx_interviews_project_active_created
  ON interviews("projectId", "isActive", "createdAt" DESC);

------------------------------------------------------------------------
-- questions  (always queried by interviewId, ordered by "order")
------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_questions_interviewId
  ON questions("interviewId");

CREATE INDEX IF NOT EXISTS idx_questions_interview_order
  ON questions("interviewId", "order");

------------------------------------------------------------------------
-- sessions  (dashboard + results all filter by interviewId)
------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sessions_interviewId
  ON sessions("interviewId");

CREATE INDEX IF NOT EXISTS idx_sessions_currentQuestionId
  ON sessions("currentQuestionId");

-- Dashboard groups/filters by status and orders by recency
CREATE INDEX IF NOT EXISTS idx_sessions_interview_status_created
  ON sessions("interviewId", "status", "createdAt" DESC);

------------------------------------------------------------------------
-- messages  (dashboard batch-loads messages by sessionId; this was the
--            single biggest unindexed scan)
------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_messages_sessionId
  ON messages("sessionId");

CREATE INDEX IF NOT EXISTS idx_messages_questionId
  ON messages("questionId");

CREATE INDEX IF NOT EXISTS idx_messages_session_timestamp
  ON messages("sessionId", "timestamp");

------------------------------------------------------------------------
-- candidates  (looked up by interviewId and by sessionId / inviteToken)
------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_candidates_interviewId
  ON candidates("interviewId");

CREATE INDEX IF NOT EXISTS idx_candidates_sessionId
  ON candidates("sessionId");

CREATE INDEX IF NOT EXISTS idx_candidates_inviteToken
  ON candidates("inviteToken");

------------------------------------------------------------------------
-- membership / access-control lookups (hit on nearly every authed query)
------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_orgmembers_userId
  ON organization_members("userId");

CREATE INDEX IF NOT EXISTS idx_orgmembers_workspaceId
  ON organization_members("workspaceId");

CREATE INDEX IF NOT EXISTS idx_projectmembers_userId
  ON project_members("userId");

CREATE INDEX IF NOT EXISTS idx_projectmembers_projectId
  ON project_members("projectId");

CREATE INDEX IF NOT EXISTS idx_projects_organizationId
  ON projects("organizationId");

------------------------------------------------------------------------
-- audit_logs / api_keys (admin + auth paths)
------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_audit_userId_created
  ON audit_logs("userId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS idx_audit_resource
  ON audit_logs("resourceType", "resourceId");

CREATE INDEX IF NOT EXISTS idx_apikeys_userId
  ON api_keys("userId");
