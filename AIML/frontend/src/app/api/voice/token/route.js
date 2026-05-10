import { NextResponse } from "next/server";
import { supabaseAdmin } from '../../../../lib/supabase/admin.js';
import { createLogger } from '../../../../lib/logger.js';

const log = createLogger("api/voice/token");

/**
 * POST /api/voice/token
 * Validate the interview exists and return session metadata.
 */
export async function POST(req) {
  const { interviewId, sessionId } = await req.json();

  try {
    const { data: interview } = await supabaseAdmin
      .from("interviews")
      .select("*, questions(*)")
      .eq("id", interviewId)
      .order("order", { referencedTable: "questions", ascending: true })
      .single();

    if (!interview) {
      return NextResponse.json(
        { error: "Interview not found" },
        { status: 404 },
      );
    }

    const questions = interview.questions ?? [];

    return NextResponse.json({
      sessionId,
      interviewTitle: interview.title,
      aiName: interview.aiName,
      questionCount: questions.length,
    });
  } catch (error) {
    log.error("Voice session init error:", error);
    return NextResponse.json(
      { error: "Failed to initialize voice session" },
      { status: 500 },
    );
  }
}
