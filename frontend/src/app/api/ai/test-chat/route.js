// Isolated test-chat API — no database, no session validation.
// Only used by /i/test. Safe because it cannot read or write any real session data.

import { getProvider } from '../../../../lib/ai/registry.js';
import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `You are a friendly but rigorous Python technical interviewer.
You are conducting a structured interview with hardcoded questions provided to you.
Rules:
- Ask the current question clearly at the start, then evaluate the candidate's answer.
- For THEORY questions: Ask the question, listen, then probe with 1-2 follow-up questions before moving on.
- For CODING questions: Show the problem, ask them to describe their approach first, then review any code they write. Give hints if they're stuck.
- When you are satisfied with an answer, say something like "Great, let's move on." and include the token [NEXT_QUESTION] at the very end of your message.
- When all questions are done, say a professional closing and include [INTERVIEW_COMPLETE] at the very end.
- Keep responses concise — 2-4 sentences max per reply unless explaining a concept.
- Never reveal the answer directly. Guide with Socratic questions.`;

export async function POST(req) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { messages, currentQuestionIndex, questions } = body;

  if (!questions || !Array.isArray(questions)) {
    return NextResponse.json({ error: "questions array is required" }, { status: 400 });
  }

  try {
    const provider = getProvider(null); // Uses default (OpenAI → Kimi → MiniMax)

    const currentQ = questions[currentQuestionIndex ?? 0];
    const questionContext = currentQ
      ? `\n\nCurrent Question (${currentQuestionIndex + 1}/${questions.length}): [${currentQ.type}] ${currentQ.text}${currentQ.starterCode ? `\n\nStarter code provided:\n\`\`\`python\n${currentQ.starterCode}\n\`\`\`` : ""}`
      : "\n\nAll questions have been completed.";

    const systemWithContext = SYSTEM_PROMPT + questionContext;

    const promptMessages = [
      { role: "system", content: systemWithContext },
      ...(messages ?? []).map((m) => ({
        role: m.role === "USER" ? "user" : "assistant",
        content: m.content,
      })),
    ];

    const response = await provider.generateResponse({
      messages: promptMessages,
      temperature: 0.7,
      maxTokens: 512,
    });

    const isComplete = response.content.includes("[INTERVIEW_COMPLETE]");
    const questionAdvanced = response.content.includes("[NEXT_QUESTION]");

    const cleanContent = response.content
      .replace("[INTERVIEW_COMPLETE]", "")
      .replace("[NEXT_QUESTION]", "")
      .trim();

    return NextResponse.json({ content: cleanContent, questionAdvanced, isComplete });
  } catch (error) {
    console.error("[test-chat] AI error:", error);
    return NextResponse.json({ error: "Failed to generate response" }, { status: 500 });
  }
}
