import { assertInterviewProjectAccess } from '../../../../../../app/api/v1/_lib/interview-access.js';
import {
    apiError,
    isAuthError,
    validateApiKey,
} from '../../../../../../lib/api-key-auth.js';
import { nanoid } from '../../../../../../lib/id.js';
import { supabaseAdmin } from '../../../../../../lib/supabase/admin.js';

const APP_BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://aural-ai.com";

function normalizeCandidateInput(raw) {
  if (!raw || typeof raw !== "object") return null;
  return raw;
}

export async function GET(request, { params }) {
  const auth = await validateApiKey(request);
  if (isAuthError(auth)) return auth;

  const { id: interviewId } = await params;

  const access = await assertInterviewProjectAccess(interviewId, auth.projectIds);
  if (access instanceof Response) return access;

  const { data: candidates, error } = await supabaseAdmin
    .from("candidates")
    .select(
      "id, name, email, phone, notes, inviteToken, sessionId, createdAt",
    )
    .eq("interviewId", interviewId)
    .order("createdAt", { ascending: false });

  if (error) {
    return apiError("INTERNAL_ERROR", error.message, 500);
  }

  return Response.json({ data: candidates ?? [] });
}

export async function POST(request, { params }) {
  const auth = await validateApiKey(request);
  if (isAuthError(auth)) return auth;

  const { id: interviewId } = await params;

  const access = await assertInterviewProjectAccess(interviewId, auth.projectIds);
  if (access instanceof Response) return access;

  let body;
  try {
    body = await request.json();
  } catch {
    return apiError("BAD_REQUEST", "Invalid JSON body", 400);
  }

  const rawItems = Array.isArray(body) ? body : [body];
  if (rawItems.length === 0) {
    return apiError("BAD_REQUEST", "At least one candidate is required", 400);
  }
  if (rawItems.length > 500) {
    return apiError("BAD_REQUEST", "Maximum 500 candidates per request", 400);
  }

  const rows = [];

  for (const item of rawItems) {
    const c = normalizeCandidateInput(item);
    if (!c) {
      return apiError("BAD_REQUEST", "Each candidate must be an object", 400);
    }

    const name = typeof c.name === "string" ? c.name.trim() : "";
    const emailRaw = typeof c.email === "string" ? c.email.trim().toLowerCase() : "";
    const phone = typeof c.phone === "string" ? c.phone.trim() || null : null;
    const notes = typeof c.notes === "string" ? c.notes.trim() || null : null;

    rows.push({
      interviewId,
      name,
      email: emailRaw || null,
      phone,
      notes,
      inviteToken: nanoid(12),
    });
  }

  const { data: created, error } = await supabaseAdmin
    .from("candidates")
    .insert(rows)
    .select(
      "id, name, email, phone, notes, inviteToken, sessionId, createdAt, updatedAt",
    );

  if (error) {
    return apiError("INTERNAL_ERROR", error.message, 500);
  }

  const data = (created ?? []).map((row) => ({
    ...row,
    inviteUrl: `${APP_BASE}/invite/${row.inviteToken}`,
  }));

  return Response.json({ data });
}
