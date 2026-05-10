import {
  apiError,
  isAuthError,
  validateApiKey,
} from '../../../../lib/api-key-auth.js';
import { nanoid } from '../../../../lib/id.js';
import { supabaseAdmin } from '../../../../lib/supabase/admin.js';

export async function GET(request) {
  const auth = await validateApiKey(request);
  if (isAuthError(auth)) return auth;

  const { searchParams } = new URL(request.url);
  let limit = Number.parseInt(searchParams.get("limit") ?? "20", 10);
  if (Number.isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;
  const cursor = searchParams.get("cursor") ?? undefined;

  if (auth.projectIds.length === 0) {
    return Response.json({ data: [], cursor: null });
  }

  let query = supabaseAdmin
    .from("interviews")
    .select("*, questions(id), sessions(id)")
    .in("projectId", auth.projectIds)
    .order("updatedAt", { ascending: false })
    .limit(limit + 1);

  if (cursor) {
    const { data: cursorRow } = await supabaseAdmin
      .from("interviews")
      .select("updatedAt")
      .eq("id", cursor)
      .single();
    if (cursorRow?.updatedAt) {
      query = query.lte("updatedAt", cursorRow.updatedAt);
    }
  }

  const { data: raw, error } = await query;
  if (error) {
    return apiError("INTERNAL_ERROR", error.message, 500);
  }

  const rows = raw ?? [];
  const page = rows.slice(0, limit);
  const data = page.map((row) => {
    const r = { ...row };
    const questions = r.questions;
    const sessions = r.sessions;
    delete r.questions;
    delete r.sessions;
    return {
      ...r,
      _count: {
        questions: questions?.length ?? 0,
        sessions: sessions?.length ?? 0,
      },
    };
  });

  let nextCursor = null;
  if (rows.length > limit) {
    const last = page[page.length - 1];
    nextCursor = last?.id ?? null;
  }

  return Response.json({ data, cursor: nextCursor });
}

function isAssessmentCriteria(v) {
  if (!Array.isArray(v)) return false;
  return v.every(
    (x) =>
      x &&
      typeof x === "object" &&
      typeof x.name === "string" &&
      typeof x.description === "string",
  );
}

export async function POST(request) {
  const auth = await validateApiKey(request);
  if (isAuthError(auth)) return auth;

  if (auth.projectIds.length === 0) {
    return apiError("BAD_REQUEST", "No accessible project found for this API key.", 400);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return apiError("BAD_REQUEST", "Invalid JSON body.", 400);
  }

  const title = body.title;
  if (typeof title !== "string" || !title.trim()) {
    return apiError("BAD_REQUEST", "title is required.", 400);
  }

  const assessmentCriteria = body.assessmentCriteria;
  if (
    assessmentCriteria !== undefined &&
    assessmentCriteria !== null &&
    !isAssessmentCriteria(assessmentCriteria)
  ) {
    return apiError("BAD_REQUEST", "assessmentCriteria must be an array of { name, description }.", 400);
  }

  const projectId = auth.projectIds[0];

  const chatEnabled = typeof body.chatEnabled === "boolean" ? body.chatEnabled : true;
  const voiceEnabled = typeof body.voiceEnabled === "boolean" ? body.voiceEnabled : false;
  const videoEnabled = typeof body.videoEnabled === "boolean" ? body.videoEnabled : false;
  const aiName = typeof body.aiName === "string" && body.aiName.trim() ? body.aiName.trim() : "Aural";
  const aiTone = body.aiTone === "CASUAL" || body.aiTone === "PROFESSIONAL" || body.aiTone === "FORMAL" || body.aiTone === "FRIENDLY" ? body.aiTone : "PROFESSIONAL";
  const followUpDepth = body.followUpDepth === "LIGHT" || body.followUpDepth === "MODERATE" || body.followUpDepth === "DEEP" ? body.followUpDepth : "MODERATE";
  const language = typeof body.language === "string" && body.language.trim() ? body.language.trim() : "en";
  const antiCheatingEnabled = typeof body.antiCheatingEnabled === "boolean" ? body.antiCheatingEnabled : false;

  let timeLimitMinutes = null;
  if (body.timeLimitMinutes !== undefined && body.timeLimitMinutes !== null) {
    if (typeof body.timeLimitMinutes !== "number" || !Number.isInteger(body.timeLimitMinutes) || body.timeLimitMinutes < 1) {
      return apiError("BAD_REQUEST", "timeLimitMinutes must be a positive integer.", 400);
    }
    timeLimitMinutes = body.timeLimitMinutes;
  }

  const insert = {
    title: title.trim(),
    description: typeof body.description === "string" ? body.description : undefined,
    objective: typeof body.objective === "string" ? body.objective : undefined,
    assessmentCriteria: assessmentCriteria ?? undefined,
    chatEnabled,
    voiceEnabled,
    videoEnabled,
    aiName,
    aiTone,
    followUpDepth,
    language,
    timeLimitMinutes,
    antiCheatingEnabled,
    projectId,
    userId: auth.userId,
    requireInvite: true,
    publicSlug: nanoid(10),
  };

  const { data: interview, error } = await supabaseAdmin
    .from("interviews")
    .insert(insert)
    .select()
    .single();

  if (error) {
    return apiError("INTERNAL_ERROR", error.message, 500);
  }

  return Response.json({ data: interview });
}
