// NEW REQUIRED FILE: src/lib/ai-client.js
// This file is imported by src/server/routers/session.js but was MISSING from the codebase.
// Without it, the entire session router fails to import (Module Not Found error at startup).

import { createLogger } from './logger.js';

const log = createLogger('ai-client');

/**
 * AI client wrapper — provides evaluateSession() used by session.complete tRPC mutation.
 * Delegates to the existing AI provider registry rather than making an HTTP call to self.
 */
export const aiClient = {
  /**
   * Evaluate a completed interview session using AI.
   *
   * @param {object} params
   * @param {string} params.sessionId
   * @param {string} params.role - Candidate's target role (from interview title)
   * @param {string} params.topic - Interview topic/objective
   * @param {Array}  params.messages - Session messages array
   * @param {Array}  params.proctor_logs - Anti-cheating log entries
   * @returns {Promise<object>} Evaluation result with summary, themes, sentiment, overall_score, insights
   */
  async evaluateSession({ sessionId, role, topic, messages = [], proctor_logs = [] }) {
    try {
      // Dynamic imports to avoid circular dependency issues at module load time
      const [
        { getProvider, REPORT_MODEL },
        { extractJson },
      ] = await Promise.all([
        import('./ai/registry.js'),
        import('./ai/extract-json.js'),
      ]);

      const provider = getProvider(REPORT_MODEL);

      // Build a simplified evaluation prompt from the session messages
      const textMessages = messages
        .filter((m) => (m.contentType === 'TEXT' || !m.contentType) && m.content?.trim())
        .map((m) => ({
          role: (m.role ?? 'USER').toLowerCase() === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        }));

      if (textMessages.length === 0) {
        log.warn(`evaluateSession: no text messages for session ${sessionId}`);
        return {
          summary: 'No interview conversation was recorded.',
          themes: [],
          sentiment: 'neutral',
          overall_score: null,
          insights: { keyInsights: [] },
        };
      }

      const systemPrompt = `You are an expert technical interviewer evaluating a candidate interview for the role of "${role}".
Topic: ${topic}

Analyze the following conversation and return a JSON object with:
{
  "summary": "2-3 sentence executive summary of the candidate's overall performance",
  "themes": ["list", "of", "3-5", "key", "topics", "discussed"],
  "sentiment": "positive" | "neutral" | "negative",
  "overall_score": number from 0-100 (overall interview performance),
  "keyInsights": ["list of 3-5 key observations about the candidate"]
}

Return ONLY the JSON object. No markdown, no explanation.`;

      const promptMessages = [
        { role: 'system', content: systemPrompt },
        ...textMessages.slice(-40), // limit to last 40 messages to stay within token budget
      ];

      const response = await provider.generateResponse({
        messages: promptMessages,
        temperature: 0.3,
        maxTokens: 2048,
        model: REPORT_MODEL,
      });

      const parsed = extractJson(response.content);

      return {
        summary: String(parsed.summary ?? ''),
        themes: Array.isArray(parsed.themes) ? parsed.themes : [],
        sentiment: parsed.sentiment ?? 'neutral',
        overall_score: typeof parsed.overall_score === 'number' ? parsed.overall_score : null,
        insights: {
          keyInsights: Array.isArray(parsed.keyInsights) ? parsed.keyInsights : [],
        },
      };

    } catch (e) {
      log.error(`evaluateSession failed for ${sessionId}:`, e);
      // Return a non-null object with error flag so the caller can distinguish
      // "evaluation failed" from "session not found"
      return {
        error: e.message,
        summary: null,
        themes: [],
        sentiment: null,
        overall_score: null,
        insights: { keyInsights: [] },
      };
    }
  },
};

export default aiClient;
