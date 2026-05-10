import { buildInterviewerPrompt } from '../../../../lib/ai/prompts/interviewer.js';
import { getProvider } from '../../../../lib/ai/registry.js';
import { createLogger } from '../../../../lib/logger.js';
import { supabaseAdmin } from '../../../../lib/supabase/admin.js';
import { NextResponse } from "next/server";

const log = createLogger("api/ai/chat");

export async function POST(req) {
  const { sessionId, interviewId, messages, currentQuestionIndex } = await req.json();

  try {
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

    const conversationHistory = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const promptMessages = buildInterviewerPrompt({
      interview: interview,
      conversationHistory,
      currentQuestionIndex: currentQuestionIndex ?? 0,
    });

    const response = await provider.generateResponse({
      messages: promptMessages,
      temperature: 0.7,
      maxTokens: 1024,
      model: interview.llmModel ?? undefined,
    });

    const isComplete = response.content.includes("[INTERVIEW_COMPLETE]");
    const questionAdvanced = response.content.includes("[NEXT_QUESTION]");

    const cleanContent = response.content
      .replace("[INTERVIEW_COMPLETE]", "")
      .replace("[NEXT_QUESTION]", "")
      .trim();

    await supabaseAdmin.from("messages").insert({
      sessionId,
      role: "ASSISTANT",
      content: cleanContent,
      wordCount: cleanContent.split(/\s+/).length,
    });

    if (questionAdvanced) {
      const nextIndex = (currentQuestionIndex ?? 0) + 1;
      const questions = interview.questions ?? [];
      const nextQuestion = questions[nextIndex];
      if (nextQuestion) {
        await supabaseAdmin
          .from("sessions")
          .update({ currentQuestionId: nextQuestion.id })
          .eq("id", sessionId);
      }
    }

    return NextResponse.json({
      content: cleanContent,
      questionAdvanced,
      isComplete,
    });
  } catch (error) {
    log.error("Chat AI error:", error);
    return NextResponse.json({ error: "Failed to generate response" }, { status: 500 });
  }
}
