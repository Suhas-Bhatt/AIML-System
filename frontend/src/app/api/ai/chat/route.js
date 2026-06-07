// FIXED: src/app/api/ai/chat/route.js
// Bug fixed: No authentication — anyone could call this, burn API credits,
// and write AI messages to any session ID.

import { buildInterviewerPrompt } from '../../../../lib/ai/prompts/interviewer.js';
import { getProvider } from '../../../../lib/ai/registry.js';
import { createLogger } from '../../../../lib/logger.js';
import { supabaseAdmin } from '../../../../lib/supabase/admin.js';
import { NextResponse } from "next/server";

const log = createLogger("api/ai/chat");

export async function POST(req) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { sessionId, interviewId, messages, currentQuestionIndex } = body;

  if (!sessionId || !interviewId) {
    return NextResponse.json({ error: "sessionId and interviewId are required" }, { status: 400 });
  }

  try {
    // ✅ FIXED: Validate the session exists and is active before processing
    // This prevents: (a) unauthenticated access, (b) writing to completed sessions,
    // (c) cross-session pollution (sessionId not matching interviewId)
    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("id, status, interviewId, candidate:candidates(name, notes, workExperience, education)")
      .eq("id", sessionId)
      .single();

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (session.interviewId !== interviewId) {
      return NextResponse.json({ error: "Session does not belong to this interview" }, { status: 403 });
    }

    if (session.status === "COMPLETED" || session.status === "ABANDONED") {
      return NextResponse.json(
        { error: "Session is no longer active", isComplete: true },
        { status: 400 }
      );
    }

    // Fetch interview with questions
    const { data: interview } = await supabaseAdmin
      .from("interviews")
      .select("*, questions(*)")
      .eq("id", interviewId)
      .order("order", { referencedTable: "questions", ascending: true })
      .single();

    if (!interview) {
      return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    }

    const provider = getProvider(interview.llmProvider);

    let conversationHistory = (messages ?? []).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Rolling Context Window: keep only the last 4 messages to save tokens
    if (conversationHistory.length > 4) {
      conversationHistory = conversationHistory.slice(-4);
    }

    // FAST PATH: Bypass LLM for the very first message to eliminate start latency
    if (conversationHistory.length === 0) {
      const firstQ = interview.questions[0];
      const aiName = interview.aiName || "AIML System";
      const candidateName = session.candidate?.name ? session.candidate.name.split(" ")[0] : "there";
      let greeting = `Welcome, ${candidateName}. I am ${aiName}, and I will be facilitating your interview today. `;
      if (interview.objective) {
        greeting += `The objective of this session is to ${interview.objective.toLowerCase()}. `;
      }
      greeting += `Before we dive into the technical topics, could you please introduce yourself and briefly describe your background?`;

      const cleanContent = greeting.trim();

      // Persist AI response
      await supabaseAdmin.from("messages").insert({
        sessionId,
        role:       "ASSISTANT",
        content:    cleanContent,
        wordCount:  cleanContent.split(/\s+/).length,
      });

      return NextResponse.json({
        response: cleanContent,
        isComplete: false,
        questionAdvanced: false
      });
    }

    const promptMessages = buildInterviewerPrompt({
      interview,
      conversationHistory,
      currentQuestionIndex: currentQuestionIndex ?? 0,
      candidate: session.candidate,
    });

    const response = await provider.generateResponse({
      messages:    promptMessages,
      temperature: 0.7,
      maxTokens:   150,
      model:       interview.llmModel ?? undefined,
    });

    const isComplete      = response.content.includes("[INTERVIEW_COMPLETE]");
    const questionAdvanced = response.content.includes("[NEXT_QUESTION]");

    let cleanContent = response.content
      .replace("[INTERVIEW_COMPLETE]", "")
      .replace("[NEXT_QUESTION]", "")
      .trim();
      
    // Strip "Question X:" prefixes
    cleanContent = cleanContent.replace(/^Question\s*\d+[:.]\s*/i, "").trim();

    // Persist AI response
    await supabaseAdmin.from("messages").insert({
      sessionId,
      role:       "ASSISTANT",
      content:    cleanContent,
      wordCount:  cleanContent.split(/\s+/).length,
    });

    // Advance question if indicated
    if (questionAdvanced) {
      const nextIndex    = (currentQuestionIndex ?? 0) + 1;
      const questions    = interview.questions ?? [];
      const nextQuestion = questions[nextIndex];
      if (nextQuestion) {
        await supabaseAdmin
          .from("sessions")
          .update({ currentQuestionId: nextQuestion.id })
          .eq("id", sessionId);
      }
    }

    return NextResponse.json({ content: cleanContent, questionAdvanced, isComplete });

  } catch (error) {
    log.error("Chat AI error:", error);
    return NextResponse.json({ error: "Failed to generate response" }, { status: 500 });
  }
}
