import { apiError } from '../../../../lib/api-key-auth.js';
import { supabaseAdmin } from '../../../../lib/supabase/admin.js';

export async function assertInterviewProjectAccess(
  interviewId,
  projectIds,
) {
  const { data: interview, error } = await supabaseAdmin
    .from("interviews")
    .select("projectId")
    .eq("id", interviewId)
    .single();

  if (error || !interview) {
    return apiError("NOT_FOUND", "Interview not found", 404);
  }

  if (!projectIds.includes(interview.projectId)) {
    return apiError("FORBIDDEN", "You do not have access to this interview", 403);
  }

  return { projectId: interview.projectId };
}
