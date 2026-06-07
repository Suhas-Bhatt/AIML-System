-- supabase/migrations/006_dashboard_stats_rpc.sql
-- Aggregated dashboard stats in a single SQL call
-- Replaces N+1 pattern: interviews → sessions → messages → aggregate in JS

-- ─────────────────────────────────────────────────────────────────────
-- Function: get_dashboard_stats(org_id)
-- Returns a single JSON object with all stats needed by the dashboard
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_dashboard_stats(p_org_id UUID)
RETURNS JSON
LANGUAGE sql
STABLE   -- result is stable within a transaction (allows query planner caching)
SECURITY DEFINER  -- runs as function owner to bypass RLS for aggregate counts
AS $$
  WITH
  -- All interviews accessible from the org's projects
  org_interviews AS (
    SELECT i.id AS interview_id
    FROM interviews i
    JOIN projects p ON i."projectId" = p.id
    WHERE p."organizationId" = p_org_id
      AND i."isActive" = true
  ),
  -- Session stats
  session_stats AS (
    SELECT
      s."interviewId",
      s.id          AS session_id,
      s.status,
      s.created_at,
      s.participant_name,
      s.participant_email,
      EXTRACT(EPOCH FROM (s.ended_at - s.started_at)) / 60.0 AS duration_minutes
    FROM sessions s
    WHERE s."interviewId" IN (SELECT interview_id FROM org_interviews)
  ),
  -- Aggregated counts
  agg AS (
    SELECT
      COUNT(DISTINCT oi.interview_id)                    AS total_interviews,
      COUNT(DISTINCT ss.session_id)                      AS total_sessions,
      COUNT(DISTINCT ss.session_id) FILTER (
        WHERE ss.status = 'COMPLETED'
      )                                                  AS completed_sessions,
      ROUND(
        AVG(ss.duration_minutes) FILTER (
          WHERE ss.duration_minutes IS NOT NULL
            AND ss.duration_minutes > 0
        )::numeric, 1
      )                                                  AS avg_duration_minutes
    FROM org_interviews oi
    LEFT JOIN session_stats ss ON ss."interviewId" = oi.interview_id
  ),
  -- Recent sessions (last 10)
  recent AS (
    SELECT
      json_agg(
        json_build_object(
          'id',              ss.session_id,
          'status',          ss.status,
          'participantName', ss.participant_name,
          'participantEmail',ss.participant_email,
          'createdAt',       ss.created_at,
          'durationMinutes', ROUND(ss.duration_minutes::numeric, 1)
        )
        ORDER BY ss.created_at DESC
      ) AS data
    FROM (
      SELECT * FROM session_stats ORDER BY created_at DESC LIMIT 10
    ) ss
  ),
  -- Status breakdown
  status_breakdown AS (
    SELECT
      json_build_object(
        'COMPLETED',   COUNT(*) FILTER (WHERE status = 'COMPLETED'),
        'IN_PROGRESS', COUNT(*) FILTER (WHERE status = 'IN_PROGRESS'),
        'NOT_STARTED', COUNT(*) FILTER (WHERE status = 'NOT_STARTED')
      ) AS data
    FROM session_stats
  )
  SELECT
    json_build_object(
      'totalInterviews',     (SELECT total_interviews    FROM agg),
      'totalSessions',       (SELECT total_sessions      FROM agg),
      'completedSessions',   (SELECT completed_sessions  FROM agg),
      'completionRate',      CASE
                               WHEN (SELECT total_sessions FROM agg) = 0 THEN 0
                               ELSE ROUND(
                                 100.0 * (SELECT completed_sessions FROM agg)
                                 / (SELECT total_sessions FROM agg), 1
                               )
                             END,
      'avgSessionDuration',  COALESCE((SELECT avg_duration_minutes FROM agg), 0),
      'statusBreakdown',     (SELECT data FROM status_breakdown),
      'recentSessions',      COALESCE((SELECT data FROM recent), '[]'::json)
    );
$$;

-- Grant execute to authenticated users (Supabase auth)
GRANT EXECUTE ON FUNCTION get_dashboard_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_dashboard_stats(UUID) TO service_role;
