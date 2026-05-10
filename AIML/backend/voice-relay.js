/**
 * WebSocket relay server for Volcengine S2S (Speech-to-Speech).
 *
 * Browser <-> this relay <-> Volcengine S2S API
 */
import { randomUUID } from "crypto";
import { config } from "dotenv";
import { WebSocket, WebSocketServer } from "ws";
import {
  buildFinishConnection,
  buildFinishSession,
  buildSayHello,
  buildSendAudio,
  buildStartConnection,
  buildStartSession,
  parseResponse,
  SERVER_ERROR_RESPONSE,
  ServerEvent,
} from "./volcengine-protocol.js";
import {
  isUserEndRequest,
  isUserSkipRequest,
  responseInvitesUserReply,
} from "./voice-relay-helpers.js";
import { bt } from "../frontend/src/lib/i18n.js";
import { createLogger } from "../frontend/src/lib/logger.js";
import { SPOKEN, PROMPTS } from "./voice-relay-prompts.js";

const log = createLogger("voice-relay");

config({ path: ".env.local" });
config({ path: ".env" });

// -- Configuration

const RELAY_PORT = Number(process.env.VOICE_RELAY_PORT) || 8766;
const VOLCENGINE_WS_URL =
  process.env.DOUBAO_WS_URL ||
  "wss://openspeech.bytedance.com/api/v3/realtime/dialogue";
const APP_ID = process.env.DOUBAO_APP_ID || "";
const ACCESS_TOKEN = process.env.DOUBAO_ACCESS_TOKEN || "";
const APP_KEY = process.env.DOUBAO_APP_KEY || "";
const RESOURCE_ID = process.env.DOUBAO_RESOURCE_ID || "";
const TTS_VOICE_ZH = process.env.DOUBAO_VOICE_ZH || "";
const TTS_VOICE_EN = process.env.DOUBAO_VOICE_EN || "";

function buildTTSOptions(language) {
  const isZh = language?.toLowerCase().startsWith("zh");
  const voiceType = isZh ? TTS_VOICE_ZH : TTS_VOICE_EN;
  if (!voiceType) return undefined;
  return { voice_type: voiceType };
}

if (!APP_ID || !ACCESS_TOKEN) {
  log.error("Missing DOUBAO_APP_ID or DOUBAO_ACCESS_TOKEN in .env.local");
  process.exit(1);
}

// -- LLM helper for on-the-fly summarization

const RELAY_LLM_API_KEY = process.env.RELAY_LLM_API_KEY || process.env.KIMI_API_KEY || process.env.MINIMAX_API_KEY || "";
const RELAY_LLM_BASE_URL = process.env.RELAY_LLM_BASE_URL
  || (process.env.KIMI_API_KEY
    ? (process.env.KIMI_BASE_URL || "https://api.moonshot.cn/v1")
    : (process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1"));
const RELAY_LLM_MODEL = process.env.RELAY_LLM_MODEL
  || (process.env.KIMI_API_KEY ? "moonshot-v1-8k" : "abab6.5s-chat");

if (RELAY_LLM_API_KEY) {
  log.info(`Summarization LLM: ${RELAY_LLM_MODEL} @ ${RELAY_LLM_BASE_URL}`);
}

async function callLLM(prompt, maxTokens = 150) {
  if (!RELAY_LLM_API_KEY) {
    log.warn("No LLM API key for summarization");
    return "";
  }

  const startMs = Date.now();
  const res = await fetch(`${RELAY_LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RELAY_LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: RELAY_LLM_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`LLM API ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await res.json();
  const elapsed = Date.now() - startMs;
  log.info(`LLM summarization took ${elapsed}ms`);
  return data.choices?.[0]?.message?.content?.trim() || "";
}

// -- Vision LLM for whiteboard description

const VISION_LLM_API_KEY = process.env.KIMI_API_KEY || "";
const VISION_LLM_BASE_URL = process.env.KIMI_BASE_URL || "https://api.moonshot.cn/v1";
const VISION_LLM_MODEL = "moonshot-v1-128k-vision-preview";

async function describeWhiteboard(imageDataUrl, isZh) {
  if (!VISION_LLM_API_KEY || !imageDataUrl) return "";

  const startMs = Date.now();
  try {
    const res = await fetch(`${VISION_LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VISION_LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: VISION_LLM_MODEL,
        messages: [{
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: imageDataUrl },
            },
            {
              type: "text",
              text: isZh
                ? "用1-2句话描述这个白板上画了什么。重点说明结构、组件和它们之间的关系。只输出描述。"
                : "Describe what is drawn on this whiteboard in 1-2 sentences. Focus on the structure, components, and relationships shown. Output only the description.",
            },
          ],
        }],
        temperature: 0.2,
        max_tokens: 100,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      log.error(`Vision LLM error: ${res.status} — ${errBody.slice(0, 200)}`);
      return "";
    }

    const data = await res.json();
    const desc = data.choices?.[0]?.message?.content?.trim() || "";
    log.info(`Vision LLM (${Date.now() - startMs}ms): "${desc.slice(0, 80)}..."`);
    return desc;
  } catch (err) {
    log.error("Vision LLM failed:", err);
    return "";
  }
}

// -- Correction detection

const CORRECTION_PATTERNS_ZH = [
  /请重新/i, /请选择/i, /只能选一个/i, /请再想想/i,
  /需要选择/i, /请再考虑/i, /选择一个/i, /不太对/i,
];
const CORRECTION_PATTERNS_EN = [
  /please reconsider/i, /choose only one/i, /pick (?:only )?one/i,
  /need to (?:select|choose|pick)/i, /try again/i, /that'?s not quite/i,
  /please select/i, /must pick/i, /can only choose one/i,
];

function isCorrection(text, isZh) {
  const patterns = isZh ? CORRECTION_PATTERNS_ZH : CORRECTION_PATTERNS_EN;
  return patterns.some((p) => p.test(text));
}

// -- Repetition detection

function normalizeForComparison(s) {
  return s.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, "");
}

function isSimilarResponse(a, b) {
  const na = normalizeForComparison(a);
  const nb = normalizeForComparison(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length < nb.length ? na : nb;
  const longer = na.length < nb.length ? nb : na;
  return longer.includes(shorter) || shorter.length / longer.length > 0.8;
}

// -- Text extraction helpers

function extractText(data) {
  for (const key of ["text", "content", "sentence", "delta"]) {
    if (typeof data[key] === "string" && data[key]) return data[key];
  }
  return "";
}

// -- Transition detection

const FAST_NEXT_PATTERNS = [
  /^(?:下一个问题|下一题|跳过|next\s*question|skip)\.?$/i,
];

const FAST_PREV_PATTERNS = [
  /^(?:上一个问题|上一题|previous\s*question)\.?$/i,
];

const USER_PREV_PATTERNS = [
  /(?:go|move|get)\s+back\s+(?:to\s+)?(?:the\s+)?(?:previous|last|prior)/i,
  /(?:return|go)\s+to\s+(?:the\s+)?(?:previous|last|prior)\s+(?:question|one|problem)/i,
  /(?:can|could)\s+(?:we|you|i)\s+(?:go|move|get)\s+back/i,
  /(?:let'?s|please|i\s+(?:want|need)\s+to)\s+(?:go|move|get)\s+back/i,
  /(?:revisit|re-visit)\s+(?:the\s+)?(?:previous|last|prior)/i,
  /previous\s+question/i,
  /(?:回到|返回|回去)(?:上一(?:个问题|题)|之前(?:的问题|那题))/,
  /(?:我(?:想|要|需要)|请|可以)(?:回到|返回|回去)上一/,
];

const IMPLICIT_NEXT_PATTERNS = [
  /let'?s\s+(?:move|proceed|go)\s+(?:on|forward)\s+(?:to\s+)?(?:the\s+)?next/i,
  /(?:move|proceed|go)\s+to\s+the\s+next\s+question/i,
  /we(?:'ll|\s+will)\s+(?:move|proceed|go)\s+(?:on|to\s+the\s+next)/i,
  /我们(?:进入|开始|来看)下一(?:个问题|题)/,
  /(?:进入|开始)下一(?:个问题|题)/,
  /那我们(?:继续|进入)下一/,
];

function hasImplicitTransition(text) {
  return IMPLICIT_NEXT_PATTERNS.some((p) => p.test(text));
}

const IMPLICIT_PREV_PATTERNS = [
  /(?:go|going)\s+back\s+to\s+(?:the\s+)?previous/i,
  /(?:return|returning)\s+to\s+(?:the\s+)?previous/i,
  /(?:revisit|re-visit)\s+(?:the\s+)?previous/i,
  /(?:let'?s|we(?:'ll|\s+can))\s+(?:go\s+back|return|revisit)/i,
  /(?:回到|返回|回去)(?:上一(?:个问题|题)|之前(?:的问题|那题))/,
  /我们(?:回到|返回)上一/,
];

function hasImplicitPrevTransition(text) {
  return IMPLICIT_PREV_PATTERNS.some((p) => p.test(text));
}

function looksLikeQuestion(text) {
  if (/[？?]/.test(text)) return true;
  if (/\b(?:could|can|would)\s+you\s+(?:share|explain|elaborate|describe|tell|walk|talk|give|provide)/i.test(text)) return true;
  if (/\bplease\s+(?:share|explain|elaborate|describe|tell|walk|talk|give|provide)/i.test(text)) return true;
  if (/\b(?:how|what|why|where|when)\s+(?:do|did|does|would|could|can|will|is|are|was|were)\s+(?:you|they|the|this|that|it)\b/i.test(text)) return true;
  if (/请.{0,4}(?:分享|描述|解释|说明|告诉|讲述?|谈谈?)/.test(text)) return true;
  if (/能否.{0,4}(?:分享|描述|解释|说明|告诉|讲述?|谈谈?)/.test(text)) return true;
  return false;
}

function replyKeepsConversationOpen(text, isZh) {
  return looksLikeQuestion(text) || responseInvitesUserReply(text, isZh);
}

function isFastNextRequest(text) {
  const t = text.trim();
  return FAST_NEXT_PATTERNS.some((p) => p.test(t));
}

function isFastPrevRequest(text) {
  const t = text.trim();
  return FAST_PREV_PATTERNS.some((p) => p.test(t));
}

function isUserPrevRequest(text) {
  return USER_PREV_PATTERNS.some((p) => p.test(text));
}

// -- Build prompts from interview context

function isChineseInterview(ctx) {
  return (
    ctx.language === "zh" || ctx.language.toLowerCase().includes("chinese")
  );
}

function buildSystemText(ctx) {
  return bt(isChineseInterview(ctx), SPOKEN.systemText(ctx.aiName, ctx.aiTone.toLowerCase()));
}

function buildChoiceSuffix(type, opts, isZh) {
  if (
    (type !== "SINGLE_CHOICE" && type !== "MULTIPLE_CHOICE") ||
    !opts?.options?.length
  ) {
    return "";
  }
  const labels = opts.options
    .map((o, i) => `${String.fromCharCode(65 + i)}, ${o}`)
    .join("; ");
  return bt(isZh, type === "MULTIPLE_CHOICE"
    ? SPOKEN.multipleChoiceSuffix(labels)
    : SPOKEN.singleChoiceSuffix(labels));
}

function buildGreeting(ctx) {
  const isZh = isChineseInterview(ctx);
  const firstQ = ctx.questions.sort((a, b) => a.order - b.order)[0];
  const q1Text = firstQ?.text || bt(isZh, SPOKEN.defaultQuestion);

  const opts = firstQ?.options;
  const isCodingOrWb = firstQ && (firstQ.type === "CODING" || firstQ.type === "WHITEBOARD");
  const spokenQuestion = isCodingOrWb
    ? bt(isZh, SPOKEN.codingWbIntro(firstQ.type))
    : `${q1Text}${buildChoiceSuffix(firstQ?.type ?? "", opts, isZh)}`;

  return bt(isZh, SPOKEN.greeting(ctx.aiName, ctx.title, ctx.questions.length, spokenQuestion));
}

function buildTransitionSayHello(questionIndex, nextQuestion, isZh) {
  const isCodingOrWb = nextQuestion.type === "CODING" || nextQuestion.type === "WHITEBOARD";
  const opts = nextQuestion.options;
  const qNum = questionIndex + 1;

  if (isCodingOrWb) {
    return bt(isZh, SPOKEN.transition.codingWb(qNum, bt(isZh, SPOKEN.codingWbIntro(nextQuestion.type))));
  }
  return bt(isZh, SPOKEN.transition.normal(qNum, nextQuestion.text, buildChoiceSuffix(nextQuestion.type, opts, isZh)));
}

function buildResumeGreeting(ctx, questionIndex) {
  const isZh = isChineseInterview(ctx);
  const sortedQs = ctx.questions.sort((a, b) => a.order - b.order);
  const q = sortedQs[questionIndex];
  const qNum = questionIndex + 1;

  const opts = q?.options;
  const isCodingOrWb = q && (q.type === "CODING" || q.type === "WHITEBOARD");

  if (isCodingOrWb) {
    return bt(isZh, SPOKEN.resume.codingWb(qNum, bt(isZh, SPOKEN.codingWbIntro(q.type))));
  }
  return bt(isZh, SPOKEN.resume.normal(qNum, q?.text || "", buildChoiceSuffix(q?.type ?? "", opts, isZh)));
}

function buildReturnSayHello(questionIndex, question, isZh) {
  const isCodingOrWb = question.type === "CODING" || question.type === "WHITEBOARD";
  const qNum = questionIndex + 1;

  if (isCodingOrWb) {
    return bt(isZh, SPOKEN.returnTo.codingWb(qNum, bt(isZh, SPOKEN.codingWbIntro(question.type, "continue"))));
  }

  const opts = question.options;
  let optionsSuffix = "";
  const isChoice = question.type === "SINGLE_CHOICE" || question.type === "MULTIPLE_CHOICE";
  if (isChoice && opts?.options?.length) {
    const labels = opts.options.map((o, i) => `${String.fromCharCode(65 + i)}, ${o}`).join("; ");
    optionsSuffix = bt(isZh, SPOKEN.optionsList(labels));
  }
  return bt(isZh, SPOKEN.returnTo.normal(qNum, question.text, optionsSuffix));
}

function buildWrapUpSayHello(isZh) {
  return bt(isZh, SPOKEN.wrapUp);
}

function buildFarewellSayHello(isZh) {
  return bt(isZh, SPOKEN.farewell);
}

async function summarizeQuestion(questionText, transcript, isZh) {
  if (transcript.length === 0) return "";

  const t = transcript
    .map((m) => `${m.role === "user" ? "Participant" : "Interviewer"}: ${m.text}`)
    .join("\n");

  try {
    const result = await callLLM(bt(isZh, PROMPTS.summarize(questionText, t)));
    log.info(`Q summary: "${result.slice(0, 100)}..."`);
    return result;
  } catch (err) {
    log.error("LLM summarization failed:", err);
    return bt(isZh, PROMPTS.summaryError);
  }
}

// -- Relay server

const wss = new WebSocketServer({ port: RELAY_PORT });
log.info(`Listening on ws://localhost:${RELAY_PORT}`);

wss.on("connection", (browserWs) => {
  log.info("Browser connected, waiting for init...");

  const timeout = setTimeout(() => {
    log.error("No init message received within 10s");
    browserWs.close();
  }, 10000);

  const handler = (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "mic_test") {
        clearTimeout(timeout);
        browserWs.removeListener("message", handler);
        handleMicTestConnection(browserWs);
      } else if (msg.type === "init" && msg.context) {
        clearTimeout(timeout);
        browserWs.removeListener("message", handler);
        handleBrowserConnection(browserWs, msg.context);
      }
    } catch {
      // Not JSON, ignore
    }
  };
  browserWs.on("message", handler);
});

// -- Mic test handler (ASR-only, no LLM/TTS)

async function handleMicTestConnection(browserWs) {
  log.info("Mic test mode");

  const volcSessionId = randomUUID();
  let volcWs = null;
  let isAlive = false;
  let keepAliveInterval = null;
  let asrAccumulator = "";

  const autoTimeout = setTimeout(() => {
    log.info("Mic test auto-timeout");
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(JSON.stringify({ type: "timeout" }));
    }
    cleanup();
  }, 20_000);

  function cleanup() {
    clearTimeout(autoTimeout);
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
    }
    if (isAlive && volcWs && volcWs.readyState === WebSocket.OPEN) {
      try {
        volcWs.send(buildFinishSession(volcSessionId));
        volcWs.send(buildFinishConnection());
      } catch { /* ignore */ }
    }
    volcWs?.close();
    volcWs = null;
    isAlive = false;
  }

  try {
    const connectId = randomUUID();
    const headers = {
      "X-Api-App-ID": APP_ID,
      "X-Api-Access-Key": ACCESS_TOKEN,
      "X-Api-Resource-Id": RESOURCE_ID,
      "X-Api-Connect-Id": connectId,
    };
    if (APP_KEY) headers["X-Api-App-Key"] = APP_KEY;

    volcWs = new WebSocket(VOLCENGINE_WS_URL, { headers });

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Connection timeout")), 10000);
      volcWs.on("unexpected-response", (_req, res) => {
        clearTimeout(t);
        let body = "";
        res.on("data", (chunk) => { body += chunk.toString(); });
        res.on("end", () => reject(new Error(`HTTP ${res.statusCode}: ${body || res.statusMessage}`)));
      });
      volcWs.on("open", () => { clearTimeout(t); resolve(); });
      volcWs.on("error", (e) => { clearTimeout(t); reject(e); });
    });

    volcWs.send(buildStartConnection());
    await waitForEvent(volcWs, ServerEvent.CONNECTION_STARTED, 5000);

    volcWs.send(
      buildStartSession(volcSessionId, "MicTest", "Listen to the user. Do not speak.", undefined)
    );
    await waitForEvent(volcWs, ServerEvent.SESSION_STARTED, 5000);
    isAlive = true;

    browserWs.send(JSON.stringify({ type: "ready" }));

    volcWs.on("message", (data) => {
      try {
        const resp = parseResponse(Buffer.from(data));

        if (resp.event === ServerEvent.ASR_RESPONSE) {
          const payload = resp.payload;
          const results = payload.results || [];
          if (results.length > 0 && typeof results[0].text === "string") {
            asrAccumulator = results[0].text;
          }
          if (browserWs.readyState === WebSocket.OPEN) {
            browserWs.send(JSON.stringify({ type: "asr", data: payload }));
          }
        } else if (resp.event === ServerEvent.ASR_ENDED) {
          if (browserWs.readyState === WebSocket.OPEN) {
            browserWs.send(JSON.stringify({ type: "asr_ended", text: asrAccumulator.trim() }));
          }
          asrAccumulator = "";
        } else if (
          resp.event === ServerEvent.SESSION_FINISHED ||
          resp.event === ServerEvent.SESSION_FAILED
        ) {
          isAlive = false;
        }
      } catch (err) {
        log.error("Mic test parse error:", err);
      }
    });

    volcWs.on("close", () => {
      isAlive = false;
      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(JSON.stringify({ type: "disconnected" }));
      }
    });

    volcWs.on("error", (err) => {
      log.error("Mic test Volcengine error:", err.message);
    });

    browserWs.on("message", (data) => {
      if (!volcWs || volcWs.readyState !== WebSocket.OPEN || !isAlive) return;
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "audio" && msg.data) {
          volcWs.send(buildSendAudio(volcSessionId, Buffer.from(msg.data, "hex")));
        }
      } catch { /* ignore */ }
    });

    browserWs.on("close", () => {
      log.info("Mic test: browser disconnected");
      cleanup();
    });

    keepAliveInterval = setInterval(() => {
      if (!isAlive || !volcWs || volcWs.readyState !== WebSocket.OPEN) {
        if (keepAliveInterval) clearInterval(keepAliveInterval);
        return;
      }
      volcWs.send(buildSendAudio(volcSessionId, Buffer.alloc(3200)));
    }, 2000);
  } catch (err) {
    log.error("Mic test connection failed:", err);
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(JSON.stringify({
        type: "error",
        message: `Mic test failed: ${err instanceof Error ? err.message : String(err)}`,
      }));
    }
    browserWs.close();
    cleanup();
  }
}

// -- Interview handler

async function handleBrowserConnection(browserWs, ctx) {
  let volcSessionId = randomUUID();
  let volcWs = null;
  let isAlive = false;
  let keepAliveInterval = null;

  // -- Per-question state
  let currentQuestionIndex = 0; 
  const questionSummaries = [];
  let questionTranscript = [];
  let asrAccumulator = "";
  let ttsAccumulator = "";
  let isTransitioning = false;
  let interviewDone = false;

  // -- Agent context state
  let currentCodeContent = "";
  let currentCodeLanguage = "plaintext";
  let latestWhiteboardImage = "";
  let whiteboardDirty = false;
  let cachedWhiteboardDescription = "";
  let lastResponseWasCorrection = false;
  const recentAgentResponses = [];
  let pendingWhiteboardVision = false;

  // -- Final-response state
  let awaitingFinalResponse = false;
  let pendingFinalTimeout = false;   
  let pendingInterviewEnd = false;   
  let finalResponseTimeout = null;
  let pendingLastQuestionTimeout = null;

  function endInterview() {
    if (interviewDone) return;
    interviewDone = true;
    awaitingFinalResponse = false;
    if (finalResponseTimeout) {
      clearTimeout(finalResponseTimeout);
      finalResponseTimeout = null;
    }
    if (pendingLastQuestionTimeout) {
      clearTimeout(pendingLastQuestionTimeout);
      pendingLastQuestionTimeout = null;
    }
    browserWs.send(JSON.stringify({ type: "interview_complete" }));
    log.info("Interview complete signal sent");
  }

  function queueFarewellAndEnd(reason) {
    if (interviewDone) return;

    awaitingFinalResponse = false;
    generatingResponse = false;
    suppressModelOutput = true;
    pendingTransitionAfterTts = false;
    pendingPrevTransitionAfterTts = false;

    if (finalResponseTimeout) {
      clearTimeout(finalResponseTimeout);
      finalResponseTimeout = null;
    }
    if (pendingLastQuestionTimeout) {
      clearTimeout(pendingLastQuestionTimeout);
      pendingLastQuestionTimeout = null;
    }

    const currentQ = sortedQuestions[currentQuestionIndex];
    const transcriptSnapshot = [...questionTranscript];
    if (transcriptSnapshot.length > 0) {
      summarizeQuestion(currentQ.text, transcriptSnapshot, isZh)
        .then((summary) => questionSummaries.push(summary))
        .catch(log.error);
    }

    const farewell = buildFarewellSayHello(isZh);
    awaitingSayHelloTts = true;
    skipNextTtsTranscript = true;

    if (!volcWs || volcWs.readyState !== WebSocket.OPEN || !isAlive) {
      log.warn(`${reason} — relay unavailable, ending interview without farewell audio`);
      endInterview();
      return;
    }

    volcWs.send(buildSayHello(volcSessionId, farewell));
    questionTranscript.push({ role: "assistant", text: farewell });
    pendingInterviewEnd = true;
    log.info(reason);

    setTimeout(() => {
      if (pendingInterviewEnd && !interviewDone) {
        log.warn("Farewell TTS timed out after 10s — forcing interview end");
        pendingInterviewEnd = false;
        endInterview();
      }
    }, 10_000);
  }

  // -- LLM-controlled response state
  let suppressModelOutput = false;
  let generatingResponse = false;
  let skipNextTtsTranscript = false;
  let userTurnsOnCurrentQ = 0;
  let pendingTransitionAfterTts = false;
  let pendingPrevTransitionAfterTts = false;
  let awaitingSayHelloTts = false;

  const sortedQuestions = ctx.questions.sort(
    (a, b) => a.order - b.order
  );
  const configIsZh = isChineseInterview(ctx);
  let isZh = configIsZh;

  const userLangSamples = [];
  function updateUserLanguage(text) {
    if (!text || text.length < 3) return;
    userLangSamples.push(text);
    if (userLangSamples.length > 5) userLangSamples.shift();

    const combined = userLangSamples.join(" ");
    const cjkChars = (combined.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    const totalChars = combined.replace(/\s+/g, "").length;
    if (totalChars === 0) return;

    const cjkRatio = cjkChars / totalChars;
    const detectedZh = cjkRatio > 0.3;
    if (detectedZh !== isZh) {
      isZh = detectedZh;
      log.info(`User language detected: ${detectedZh ? "zh" : "en"} (CJK ratio: ${(cjkRatio * 100).toFixed(0)}%, overriding config=${configIsZh ? "zh" : "en"})`);
    }
  }

  const startIdx = ctx.startQuestionIndex ?? 0;
  if (startIdx > 0 && startIdx < sortedQuestions.length) {
    currentQuestionIndex = startIdx;
  }

  let maxFollowUps;
  switch (ctx.followUpDepth) {
    case "LIGHT":   maxFollowUps = 1; break;
    case "MODERATE": maxFollowUps = 3; break;
    case "DEEP":    maxFollowUps = 5; break;
    default:        maxFollowUps = 1;
  }

  log.info(
    `Interview: "${ctx.title}" (${sortedQuestions.length} questions, lang=${ctx.language}, startQ=${currentQuestionIndex})`
  );

  const NEXT_TOKEN = "[NEXT]";
  const PREV_TOKEN = "[PREV]";

  async function buildAgentContext() {
    const previousContext = questionSummaries
      .map((s, i) => `Q${i + 1} (${sortedQuestions[i]?.text.slice(0, 50)}): ${s}`)
      .join("\n");

    const currentQ = sortedQuestions[currentQuestionIndex];
    const agentCtx = { memory: previousContext };

    if (currentQ.type === "CODING" && currentCodeContent) {
      agentCtx.codeContent = currentCodeContent;
      agentCtx.codeLanguage = currentCodeLanguage;
    }

    if (currentQ.type === "WHITEBOARD") {
      if (whiteboardDirty && latestWhiteboardImage) {
        log.info("Whiteboard vision: calling vision LLM (race 800ms)");
        const visionPromise = describeWhiteboard(latestWhiteboardImage, isZh);
        const result = await Promise.race([
          visionPromise.then((desc) => ({ desc, timedOut: false })),
          new Promise((resolve) =>
            setTimeout(() => resolve({ desc: "", timedOut: true }), 800)
          ),
        ]);
        if (!result.timedOut && result.desc) {
          cachedWhiteboardDescription = result.desc;
          whiteboardDirty = false;
          log.info(`Whiteboard vision: description ready (${result.desc.length} chars)`);
        } else if (result.timedOut) {
          agentCtx.whiteboardLoading = true;
          pendingWhiteboardVision = true;
          log.info("Whiteboard vision: timed out, setting loading=true for two-phase");
          visionPromise.then((desc) => {
            if (desc) {
              cachedWhiteboardDescription = desc;
              whiteboardDirty = false;
              log.info(`Whiteboard vision: background description ready (${desc.length} chars)`);
            }
            pendingWhiteboardVision = false;
          }).catch(() => { pendingWhiteboardVision = false; });
        } else if (!result.timedOut && !result.desc) {
          agentCtx.whiteboardLoading = true;
          log.info("Whiteboard vision: returned empty (likely API error), treating as loading");
        }
      }

      if (cachedWhiteboardDescription) {
        agentCtx.whiteboardDescription = cachedWhiteboardDescription;
      }
    }

    if (lastResponseWasCorrection) {
      agentCtx.correctionGuard = isZh
        ? "\n**重要：你上一条回复要求受访者重新考虑或修改答案。他们还没有回应你的纠正。等待他们的回答，绝对不要加 [NEXT]。**\n"
        : "\n**IMPORTANT: Your last response asked the participant to reconsider or revise their answer. They have NOT yet responded to your correction. Wait for their answer. Do NOT add [NEXT] under any circumstances.**\n";
    }

    if (recentAgentResponses.length >= 2) {
      const last = recentAgentResponses[recentAgentResponses.length - 1];
      const prev = recentAgentResponses[recentAgentResponses.length - 2];
      if (last && prev && isSimilarResponse(last, prev)) {
        agentCtx.antiRepetition = isZh
          ? `\n**重要：你上面的回复已经重复了（"${last.slice(0, 40)}..."）。你必须用完全不同的方式回应。仔细阅读受访者最后一句话，如果他们在问你问题，请直接回答他们的问题。不要再说类似的话。**\n`
          : `\n**IMPORTANT: Your previous responses have been repetitive ("${last.slice(0, 40)}..."). You MUST respond differently. Read the participant's last message carefully — if they are asking you a question, answer it directly. Do NOT repeat similar phrasing.**\n`;
        log.info("Anti-repetition guard activated");
      }
    }

    return agentCtx;
  }

  function getMaxTokensForQuestion(type) {
    switch (type) {
      case "CODING":
      case "WHITEBOARD":
      case "RESEARCH":
        return 250;
      case "SINGLE_CHOICE":
      case "MULTIPLE_CHOICE":
        return 200;
      default:
        return 150;
    }
  }

  async function generateControlledResponse(opts) {
    const forceSkip = opts?.forceSkip ?? false;
    const currentQ = sortedQuestions[currentQuestionIndex];
    const history = PROMPTS.formatHistory(questionTranscript, isZh);
    const agentCtx = await buildAgentContext();

    const qOpts = currentQ.options;
    let choiceInstruction = "";
    if (currentQ.type === "SINGLE_CHOICE" && qOpts?.options?.length) {
      const labels = qOpts.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join(", ");
      choiceInstruction = bt(isZh, PROMPTS.choiceInstruction.singleChoice(labels));
    } else if (currentQ.type === "MULTIPLE_CHOICE" && qOpts?.options?.length) {
      const labels = qOpts.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join(", ");
      choiceInstruction = bt(isZh, PROMPTS.choiceInstruction.multipleChoice(labels));
    } else if (currentQ.type === "CODING") {
      choiceInstruction = bt(isZh, PROMPTS.choiceInstruction.coding(NEXT_TOKEN, PREV_TOKEN));
    } else if (currentQ.type === "WHITEBOARD") {
      choiceInstruction = bt(isZh, PROMPTS.choiceInstruction.whiteboard(NEXT_TOKEN, PREV_TOKEN));
    } else if (currentQ.type === "RESEARCH") {
      choiceInstruction = bt(isZh, PROMPTS.choiceInstruction.research(NEXT_TOKEN, PREV_TOKEN));
    }

    const effectiveMaxFollowUps = currentQ.type === "RESEARCH"
      ? Math.max(maxFollowUps, 7)
      : maxFollowUps;
    const followUpsDone = Math.max(0, userTurnsOnCurrentQ - 1);
    const turnsLeft = effectiveMaxFollowUps - followUpsDone;
    let followUpInstruction;
    const isCodingOrWhiteboard = currentQ.type === "CODING" || currentQ.type === "WHITEBOARD";

    if (forceSkip) {
      const skipOverride = isZh
        ? `⚠️ 受访者已明确要求跳过/进入下一题。你必须简短回应（如"好的，没问题"），然后在回复末尾加上 ${NEXT_TOKEN}。不要试图继续提问或鼓励。`
        : `⚠️ The participant has EXPLICITLY asked to skip / move on to the next question. You MUST briefly acknowledge (e.g. "Sure, no problem") and append ${NEXT_TOKEN} at the end. Do NOT try to help further or ask more questions.`;
      followUpInstruction = skipOverride;
      choiceInstruction = "";
    } else if (lastResponseWasCorrection) {
      followUpInstruction = isZh
        ? `等待受访者回应你的纠正。不要加 ${NEXT_TOKEN}。`
        : `Wait for the participant to respond to your correction. Do NOT add ${NEXT_TOKEN}.`;
    } else if (isCodingOrWhiteboard) {
      followUpInstruction = bt(isZh, PROMPTS.followUp.codingWb(NEXT_TOKEN));
    } else if (turnsLeft <= -1) {
      followUpInstruction = bt(isZh, PROMPTS.followUp.pastLimit(NEXT_TOKEN));
    } else if (turnsLeft <= 0) {
      followUpInstruction = bt(isZh, PROMPTS.followUp.atLimit(NEXT_TOKEN));
    } else if (turnsLeft === 1) {
      followUpInstruction = bt(isZh, PROMPTS.followUp.oneLeft(NEXT_TOKEN));
    } else {
      followUpInstruction = bt(isZh, PROMPTS.followUp.remaining(turnsLeft, NEXT_TOKEN));
    }

    const promptParams = {
      aiName: ctx.aiName,
      title: ctx.title,
      qNum: currentQuestionIndex + 1,
      totalQs: sortedQuestions.length,
      qText: currentQ.text,
      qDescription: currentQ.description,
      qType: currentQ.type,
      choiceInstruction,
      history,
      followUpInstruction,
      nextToken: NEXT_TOKEN,
      prevToken: PREV_TOKEN,
      userTurns: userTurnsOnCurrentQ,
      previousContext: agentCtx.memory || undefined,
      codeContent: agentCtx.codeContent,
      codeLanguage: agentCtx.codeLanguage,
      whiteboardDescription: agentCtx.whiteboardDescription,
      whiteboardLoading: agentCtx.whiteboardLoading,
      correctionGuard: agentCtx.correctionGuard,
      antiRepetition: agentCtx.antiRepetition,
      forceLanguage: userLangSamples.length > 0 ? (isZh ? "zh" : "en") : undefined,
    };

    const prompt = bt(isZh, isCodingOrWhiteboard
      ? PROMPTS.response.codingWb(promptParams)
      : PROMPTS.response.normal(promptParams));

    const maxTokens = getMaxTokensForQuestion(currentQ.type);
    const startMs = Date.now();
    let response = await callLLM(prompt, maxTokens);

    response = response.replace(/^(追问型|结束型|FOLLOW[- ]?UP|WRAP[- ]?UP)\s*[:：]\s*/i, "").trim();

    if (!forceSkip) {
      if (response.includes(NEXT_TOKEN) && replyKeepsConversationOpen(response.replace(NEXT_TOKEN, ""), isZh)) {
        log.info("Stripped [NEXT] — response still invites a participant reply");
        response = response.replace(NEXT_TOKEN, "").trim();
      }
      if (response.includes(NEXT_TOKEN) && userTurnsOnCurrentQ === 0) {
        log.info("Stripped [NEXT] — no user response on this question yet");
        response = response.replace(NEXT_TOKEN, "").trim();
      }
      if (response.includes(NEXT_TOKEN) && lastResponseWasCorrection) {
        log.info("Stripped [NEXT] — awaiting response to correction");
        response = response.replace(NEXT_TOKEN, "").trim();
      }
    }

    if (forceSkip && !response.includes(NEXT_TOKEN)) {
      log.info("Force-adding [NEXT] — user explicitly asked to skip");
      response = response.trimEnd() + " " + NEXT_TOKEN;
    }

    lastResponseWasCorrection = isCorrection(response, isZh);
    
    const spokenResponse = response.replace(NEXT_TOKEN, "").replace(PREV_TOKEN, "").trim();
    if (spokenResponse) {
      recentAgentResponses.push(spokenResponse);
      if (recentAgentResponses.length > 5) recentAgentResponses.shift();
    }

    log.info(`Response LLM (${Date.now() - startMs}ms, ${maxTokens}tok, turn ${userTurnsOnCurrentQ}): "${response.slice(0, 100)}..."`);
    return response;
  }

  function scheduleWhiteboardFollowUp() {
    const pollInterval = 300;
    const maxWait = 5000;
    let waited = 0;

    const poll = () => {
      if (isTransitioning || interviewDone || !volcWs || volcWs.readyState !== WebSocket.OPEN || !isAlive) return;

      if (!pendingWhiteboardVision && cachedWhiteboardDescription) {
        log.info("Whiteboard vision ready — sending follow-up response");
        generatingResponse = true;
        generateControlledResponse()
          .then((followUp) => {
            generatingResponse = false;
            if (!followUp || !volcWs || volcWs.readyState !== WebSocket.OPEN || !isAlive) {
              suppressModelOutput = false;
              return;
            }
            const spokenFollowUp = followUp.replace(NEXT_TOKEN, "").replace(PREV_TOKEN, "").trim();
            if (spokenFollowUp) {
              awaitingSayHelloTts = true;
              skipNextTtsTranscript = true;
              volcWs.send(buildSayHello(volcSessionId, spokenFollowUp));
              questionTranscript.push({ role: "assistant", text: spokenFollowUp });
              log.info("Sent whiteboard follow-up via SayHello");
            }
          })
          .catch((err) => {
            log.error("Whiteboard follow-up failed:", err);
            generatingResponse = false;
          });
        return;
      }

      waited += pollInterval;
      if (waited < maxWait) {
        setTimeout(poll, pollInterval);
      } else {
        log.info("Whiteboard vision timed out — no follow-up sent");
      }
    };

    setTimeout(poll, pollInterval);
  }

  async function handleTransition(auto = false) {
    if (isTransitioning || interviewDone || !volcWs || !isAlive) return;
    isTransitioning = true;

    suppressModelOutput = true;
    generatingResponse = false;
    skipNextTtsTranscript = false;

    try {
      browserWs.send(JSON.stringify({ type: "transitioning", auto, direction: "next" }));

      const currentQ = sortedQuestions[currentQuestionIndex];
      const transcriptSnapshot = [...questionTranscript];
      questionTranscript = [];
      asrAccumulator = "";
      ttsAccumulator = "";
      userTurnsOnCurrentQ = 0;
      pendingTransitionAfterTts = false;
      pendingPrevTransitionAfterTts = false;
      awaitingSayHelloTts = false;
      lastResponseWasCorrection = false;
      cachedWhiteboardDescription = "";
      whiteboardDirty = !!latestWhiteboardImage;
      recentAgentResponses.length = 0;
      if (pendingLastQuestionTimeout) {
        clearTimeout(pendingLastQuestionTimeout);
        pendingLastQuestionTimeout = null;
      }

      currentQuestionIndex++;

      if (currentQuestionIndex < sortedQuestions.length) {
        const summaryPromise = transcriptSnapshot.length > 0
          ? summarizeQuestion(currentQ.text, transcriptSnapshot, isZh)
          : Promise.resolve("");

        const sessionTeardownPromise = (async () => {
          try {
            volcWs.send(buildFinishSession(volcSessionId));
            await waitForEvent(volcWs, ServerEvent.SESSION_FINISHED, 5000);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("stream is done")) {
              log.info("Session already ended (expected race), reconnecting");
            } else {
              log.error("FinishSession failed, reconnecting:", msg);
            }
            await reconnectVolcengine();
          }
        })();

        const [summary] = await Promise.all([summaryPromise, sessionTeardownPromise]);
        questionSummaries.push(summary);

        const nextQ = sortedQuestions[currentQuestionIndex];

        try {
          volcSessionId = randomUUID();
          const newSystemText = buildSystemText(ctx);
          volcWs.send(
            buildStartSession(volcSessionId, ctx.aiName, newSystemText, buildTTSOptions(ctx.language))
          );
          await waitForEvent(volcWs, ServerEvent.SESSION_STARTED, 5000);
          isAlive = true;
        } catch (sessionErr) {
          log.error("Session restart failed, using SayHello fallback:", sessionErr);
        }

        awaitingSayHelloTts = true;

        const transition = buildTransitionSayHello(
          currentQuestionIndex,
          nextQ,
          isZh
        );
        volcWs.send(buildSayHello(volcSessionId, transition));

        browserWs.send(
          JSON.stringify({
            type: "question_change",
            questionIndex: currentQuestionIndex,
            totalQuestions: sortedQuestions.length,
            auto,
          })
        );

        log.info(
          `→ Q${currentQuestionIndex + 1}/${sortedQuestions.length}: ${nextQ.text.slice(0, 60)}...`
        );
      } else {
        if (transcriptSnapshot.length > 0) {
          const lastSummary = await summarizeQuestion(currentQ.text, transcriptSnapshot, isZh);
          questionSummaries.push(lastSummary);
        }

        if (auto) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          if (interviewDone) return;
        }

        awaitingFinalResponse = true;
        pendingFinalTimeout = true;
        awaitingSayHelloTts = true;
        const wrapUp = buildWrapUpSayHello(isZh);
        volcWs.send(buildSayHello(volcSessionId, wrapUp));
        skipNextTtsTranscript = true;
        questionTranscript.push({ role: "assistant", text: wrapUp });

        log.info("All questions covered, awaiting final response");
      }
    } catch (err) {
      log.error("Transition error:", err);
    } finally {
      isTransitioning = false;
    }
  }

  async function handlePreviousTransition(auto = false) {
    if (isTransitioning || interviewDone || !volcWs || !isAlive) return;
    if (currentQuestionIndex <= 0) return; 
    isTransitioning = true;

    suppressModelOutput = true;
    generatingResponse = false;
    skipNextTtsTranscript = false;

    try {
      browserWs.send(JSON.stringify({ type: "transitioning", auto, direction: "previous" }));

      const transcriptSnapshot = [...questionTranscript];
      questionTranscript = [];
      asrAccumulator = "";
      ttsAccumulator = "";
      userTurnsOnCurrentQ = 0;
      pendingTransitionAfterTts = false;
      pendingPrevTransitionAfterTts = false;
      awaitingSayHelloTts = false;
      lastResponseWasCorrection = false;
      cachedWhiteboardDescription = "";
      whiteboardDirty = !!latestWhiteboardImage;
      recentAgentResponses.length = 0;
      if (pendingLastQuestionTimeout) {
        clearTimeout(pendingLastQuestionTimeout);
        pendingLastQuestionTimeout = null;
      }

      const currentQ = sortedQuestions[currentQuestionIndex];
      if (transcriptSnapshot.length > 0) {
        const summary = await summarizeQuestion(currentQ.text, transcriptSnapshot, isZh);
        questionSummaries.push(summary);
      }

      currentQuestionIndex--;

      try {
        volcWs.send(buildFinishSession(volcSessionId));
        await waitForEvent(volcWs, ServerEvent.SESSION_FINISHED, 5000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("stream is done")) {
          log.info("Session already ended (expected race), reconnecting");
        } else {
          log.error("FinishSession failed, reconnecting:", msg);
        }
        await reconnectVolcengine();
      }

      const prevQ = sortedQuestions[currentQuestionIndex];

      try {
        volcSessionId = randomUUID();
        const newSystemText = buildSystemText(ctx);
        volcWs.send(
          buildStartSession(volcSessionId, ctx.aiName, newSystemText, buildTTSOptions(ctx.language))
        );
        await waitForEvent(volcWs, ServerEvent.SESSION_STARTED, 5000);
        isAlive = true;
      } catch (sessionErr) {
        log.error("Session restart failed:", sessionErr);
      }

      awaitingSayHelloTts = true;

      const transition = buildReturnSayHello(
        currentQuestionIndex,
        prevQ,
        isZh
      );
      volcWs.send(buildSayHello(volcSessionId, transition));

      browserWs.send(
        JSON.stringify({
          type: "question_change",
          questionIndex: currentQuestionIndex,
          totalQuestions: sortedQuestions.length,
          auto: false,
        })
      );

      log.info(
        `← Q${currentQuestionIndex + 1}/${sortedQuestions.length} (back): ${prevQ.text.slice(0, 60)}...`
      );
    } catch (err) {
      log.error("Previous transition error:", err);
    } finally {
      isTransitioning = false;
    }
  }

  const systemPrompt = buildSystemText(ctx);
  const greeting = currentQuestionIndex > 0
    ? buildResumeGreeting(ctx, currentQuestionIndex)
    : buildGreeting(ctx);

  try {
    const connectId = randomUUID();
    const headers = {
      "X-Api-App-ID": APP_ID,
      "X-Api-Access-Key": ACCESS_TOKEN,
      "X-Api-Resource-Id": RESOURCE_ID,
      "X-Api-Connect-Id": connectId,
    };
    if (APP_KEY) headers["X-Api-App-Key"] = APP_KEY;

    volcWs = new WebSocket(VOLCENGINE_WS_URL, { headers });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Volcengine connection timeout")),
        10000
      );
      volcWs.on("unexpected-response", (_req, res) => {
        clearTimeout(timeout);
        let body = "";
        res.on("data", (chunk) => { body += chunk.toString(); });
        res.on("end", () => {
          reject(new Error(`Volcengine HTTP ${res.statusCode}: ${body || res.statusMessage}`));
        });
      });
      volcWs.on("open", () => { clearTimeout(timeout); resolve(); });
      volcWs.on("error", (err) => { clearTimeout(timeout); reject(err); });
    });

    volcWs.send(buildStartConnection());
    await waitForEvent(volcWs, ServerEvent.CONNECTION_STARTED, 5000);

    volcWs.send(
      buildStartSession(volcSessionId, ctx.aiName, systemPrompt, buildTTSOptions(ctx.language))
    );
    await waitForEvent(volcWs, ServerEvent.SESSION_STARTED, 5000);
    isAlive = true;

    browserWs.send(JSON.stringify({ type: "ready", sessionId: volcSessionId }));
    browserWs.send(
      JSON.stringify({
        type: "question_change",
        questionIndex: currentQuestionIndex,
        totalQuestions: sortedQuestions.length,
      })
    );

    volcWs.send(buildSayHello(volcSessionId, greeting));
  } catch (err) {
    log.error("Failed to connect to Volcengine:", err);
    browserWs.send(
      JSON.stringify({
        type: "error",
        message: `Volcengine connection failed: ${err instanceof Error ? err.message : err}`,
      })
    );
    browserWs.close();
    volcWs?.close();
    return;
  }

  const volcOnMessage = (data) => {
    try {
      const resp = parseResponse(Buffer.from(data));

      if (resp.event === ServerEvent.TTS_RESPONSE) {
        if (!suppressModelOutput && Buffer.isBuffer(resp.payload)) {
          browserWs.send(resp.payload, { binary: true });
        }
      } else if (resp.event === ServerEvent.TTS_SENTENCE_START) {
        if (awaitingSayHelloTts) {
          const p = resp.payload;
          if (p?.tts_type === "chat_tts_text") {
            awaitingSayHelloTts = false;
            suppressModelOutput = false;
          }
        }
        if (!suppressModelOutput) {
          const payload = resp.payload;
          const text = extractText(payload);
          if (text) {
            ttsAccumulator += (ttsAccumulator ? " " : "") + text;
          }
          browserWs.send(JSON.stringify({ type: "tts_text", data: payload }));
        }
      } else if (resp.event === ServerEvent.TTS_SENTENCE_END) {
        if (!suppressModelOutput) {
          browserWs.send(JSON.stringify({ type: "tts_sentence_end", data: resp.payload }));
        }
      } else if (resp.event === ServerEvent.TTS_ENDED) {
        if (!suppressModelOutput) {
          if (!skipNextTtsTranscript && ttsAccumulator.trim()) {
            questionTranscript.push({ role: "assistant", text: ttsAccumulator.trim() });
          }
          skipNextTtsTranscript = false;
          browserWs.send(JSON.stringify({ type: "tts_ended" }));

          if (pendingTransitionAfterTts && !isTransitioning && !interviewDone) {
            pendingTransitionAfterTts = false;
            const isLastQuestion = currentQuestionIndex >= sortedQuestions.length - 1;
            if (isLastQuestion) {
              pendingLastQuestionTimeout = setTimeout(() => {
                pendingLastQuestionTimeout = null;
                if (!isTransitioning && !interviewDone && !generatingResponse) {
                  handleTransition(true).catch(log.error);
                }
              }, 15_000);
            } else {
              handleTransition(true).catch(log.error);
            }
          }

          if (pendingPrevTransitionAfterTts && !isTransitioning && !interviewDone && currentQuestionIndex > 0) {
            pendingPrevTransitionAfterTts = false;
            setTimeout(() => {
              handlePreviousTransition(true).catch(log.error);
            }, 1500);
          }

          if (pendingFinalTimeout) {
            pendingFinalTimeout = false;
            suppressModelOutput = true;
            finalResponseTimeout = setTimeout(() => {
              if (!interviewDone && !awaitingFinalResponse) return;
              awaitingFinalResponse = false;
              if (finalResponseTimeout) {
                clearTimeout(finalResponseTimeout);
                finalResponseTimeout = null;
              }
              const farewell = buildFarewellSayHello(isZh);
              suppressModelOutput = true;
              awaitingSayHelloTts = true;
              skipNextTtsTranscript = true;
              if (volcWs && volcWs.readyState === WebSocket.OPEN && isAlive) {
                volcWs.send(buildSayHello(volcSessionId, farewell));
                questionTranscript.push({ role: "assistant", text: farewell });
                pendingInterviewEnd = true;
              } else {
                endInterview();
              }
            }, 15_000);
          }

          if (pendingInterviewEnd) {
            pendingInterviewEnd = false;
            endInterview();
          }
        }
        ttsAccumulator = "";
      } else if (resp.event === ServerEvent.ASR_INFO) {
        browserWs.send(JSON.stringify({ type: "interrupt" }));
      } else if (resp.event === ServerEvent.ASR_RESPONSE) {
        const payload = resp.payload;
        const results = payload.results || [];
        if (results.length > 0 && typeof results[0].text === "string") {
          asrAccumulator = results[0].text;
        }
        browserWs.send(JSON.stringify({ type: "asr", data: payload }));
      } else if (resp.event === ServerEvent.ASR_ENDED) {
        const userText = asrAccumulator.trim();
        asrAccumulator = "";

        if (userText) {
          updateUserLanguage(userText);
          questionTranscript.push({ role: "user", text: userText });
          userTurnsOnCurrentQ++;
          lastResponseWasCorrection = false;
          browserWs.send(JSON.stringify({ type: "asr_ended", text: userText }));

          if (pendingLastQuestionTimeout) {
            clearTimeout(pendingLastQuestionTimeout);
            pendingLastQuestionTimeout = null;
          }

          if (awaitingFinalResponse && !interviewDone && !generatingResponse) {
            awaitingFinalResponse = false;
            if (finalResponseTimeout) {
              clearTimeout(finalResponseTimeout);
              finalResponseTimeout = null;
            }
            const farewell = buildFarewellSayHello(isZh);
            suppressModelOutput = true;
            awaitingSayHelloTts = true;
            skipNextTtsTranscript = true;
            volcWs.send(buildSayHello(volcSessionId, farewell));
            questionTranscript.push({ role: "assistant", text: farewell });
            pendingInterviewEnd = true;
          }
          else if (!isTransitioning && !interviewDone && isUserEndRequest(userText)) {
            queueFarewellAndEnd(`Explicit interview end request: "${userText.slice(0, 80)}"`);
          }
          else if (!isTransitioning && !interviewDone && (isFastPrevRequest(userText) || isUserPrevRequest(userText))) {
            handlePreviousTransition().catch(log.error);
          }
          else if (!isTransitioning && !interviewDone && isFastNextRequest(userText)) {
            handleTransition().catch(log.error);
          }
          else if (!isTransitioning && !interviewDone && !generatingResponse) {
            const userWantsSkip = isUserSkipRequest(userText);
            suppressModelOutput = true;
            generatingResponse = true;
            generateControlledResponse({ forceSkip: userWantsSkip })
              .then((response) => {
                generatingResponse = false;
                if (!response || !volcWs || volcWs.readyState !== WebSocket.OPEN || !isAlive) {
                  suppressModelOutput = false;
                  return;
                }

                let shouldTransition = response.includes(NEXT_TOKEN);
                let shouldGoPrev = response.includes(PREV_TOKEN);
                const spokenText = response.replace(NEXT_TOKEN, "").replace(PREV_TOKEN, "").trim();

                if (!shouldTransition && !shouldGoPrev && userTurnsOnCurrentQ > 0
                    && hasImplicitTransition(spokenText) && !replyKeepsConversationOpen(spokenText, isZh)) {
                  shouldTransition = true;
                }

                if (!shouldGoPrev && !shouldTransition && hasImplicitPrevTransition(spokenText)) {
                  shouldGoPrev = true;
                }

                if (shouldTransition && !userWantsSkip && replyKeepsConversationOpen(spokenText, isZh)) {
                  shouldTransition = false;
                }
                const currentType = sortedQuestions[currentQuestionIndex]?.type;
                if (shouldTransition && !userWantsSkip && (currentType === "CODING" || currentType === "WHITEBOARD")) {
                  if (spokenText.length > 80) {
                    shouldTransition = false;
                  }
                }

                if (spokenText) {
                  awaitingSayHelloTts = true;
                  skipNextTtsTranscript = true;
                  volcWs.send(buildSayHello(volcSessionId, spokenText));
                  questionTranscript.push({ role: "assistant", text: spokenText });
                } else {
                  suppressModelOutput = false;
                }

                if (shouldGoPrev && !isTransitioning && !interviewDone && currentQuestionIndex > 0) {
                  if (spokenText) {
                    pendingPrevTransitionAfterTts = true;
                  } else {
                    handlePreviousTransition().catch(log.error);
                  }
                } else if (shouldTransition && !isTransitioning && !interviewDone) {
                  pendingTransitionAfterTts = true;
                }

                if (pendingWhiteboardVision && !shouldTransition && !shouldGoPrev) {
                  scheduleWhiteboardFollowUp();
                }
              })
              .catch((err) => {
                log.error("Response generation failed:", err);
                suppressModelOutput = false;
                generatingResponse = false;
                awaitingSayHelloTts = false;
              });
          }
        } else {
          browserWs.send(JSON.stringify({ type: "asr_ended", text: userText }));
        }
      } else if (resp.event === ServerEvent.CHAT_RESPONSE) {
        if (!suppressModelOutput) {
          browserWs.send(JSON.stringify({ type: "chat", data: resp.payload }));
        }
      } else if (resp.event === ServerEvent.CHAT_ENDED) {
        if (!suppressModelOutput) {
          browserWs.send(JSON.stringify({ type: "chat_ended" }));
        }
      } else if (
        resp.event === ServerEvent.SESSION_FINISHED ||
        resp.event === ServerEvent.SESSION_FAILED
      ) {
        if (!isTransitioning) {
          isAlive = false;
        }
      } else if (resp.event !== undefined) {
        browserWs.send(JSON.stringify({ type: "event", event: resp.event, data: resp.payload }));
      }
    } catch (err) {
      log.error("Error parsing Volcengine message:", err);
    }
  };

  let volcReconnecting = false;
  const MAX_VOLC_RECONNECT_ATTEMPTS = 3;
  const VOLC_RECONNECT_DELAY_MS = 1000;

  const volcOnClose = (code, reason) => {
    isAlive = false;
    if (isTransitioning || interviewDone) return;
    if (browserWs.readyState !== WebSocket.OPEN) return;

    if (!volcReconnecting) {
      volcReconnecting = true;
      autoReconnectVolcengine().then(() => {
        volcReconnecting = false;
      }).catch((err) => {
        volcReconnecting = false;
        if (browserWs.readyState === WebSocket.OPEN) {
          browserWs.send(JSON.stringify({ type: "disconnected" }));
          browserWs.close();
        }
      });
    }
  };

  const volcOnError = (err) => {
    log.error(`Volcengine WS error: ${err.message}`);
  };

  async function autoReconnectVolcengine() {
    browserWs.send(JSON.stringify({ type: "session_reconnecting" }));

    for (let attempt = 1; attempt <= MAX_VOLC_RECONNECT_ATTEMPTS; attempt++) {
      if (interviewDone || browserWs.readyState !== WebSocket.OPEN) return;

      const delay = VOLC_RECONNECT_DELAY_MS * attempt;
      await new Promise((r) => setTimeout(r, delay));

      if (interviewDone || browserWs.readyState !== WebSocket.OPEN) return;

      try {
        await reconnectVolcengine();

        volcSessionId = randomUUID();
        const newSystemText = buildSystemText(ctx);
        volcWs.send(
          buildStartSession(volcSessionId, ctx.aiName, newSystemText, buildTTSOptions(ctx.language))
        );
        await waitForEvent(volcWs, ServerEvent.SESSION_STARTED, 5000);
        isAlive = true;

        if (!keepAliveInterval) {
          keepAliveInterval = setInterval(() => {
            if (!isAlive || !volcWs || volcWs.readyState !== WebSocket.OPEN) return;
            volcWs.send(buildSendAudio(volcSessionId, Buffer.alloc(3200)));
          }, 2000);
        }

        suppressModelOutput = false;
        awaitingSayHelloTts = false;

        browserWs.send(JSON.stringify({ type: "session_reconnected" }));
        return;
      } catch (err) {
        log.warn(`Volcengine auto-reconnect attempt ${attempt} failed`);
      }
    }
    throw new Error("Exhausted all reconnect attempts");
  }

  function attachVolcHandlers() {
    volcWs.on("message", volcOnMessage);
    volcWs.on("close", volcOnClose);
    volcWs.on("error", volcOnError);
  }

  async function reconnectVolcengine() {
    const oldWs = volcWs;
    if (oldWs) {
      oldWs.removeAllListeners();
      try { oldWs.close(); } catch { /* ignore */ }
    }

    const connectId = randomUUID();
    const headers = {
      "X-Api-App-ID": APP_ID,
      "X-Api-Access-Key": ACCESS_TOKEN,
      "X-Api-Resource-Id": RESOURCE_ID,
      "X-Api-Connect-Id": connectId,
    };
    if (APP_KEY) headers["X-Api-App-Key"] = APP_KEY;

    volcWs = new WebSocket(VOLCENGINE_WS_URL, { headers });

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Volcengine reconnect timeout")), 10000);
      volcWs.on("open", () => { clearTimeout(t); resolve(); });
      volcWs.on("error", (e) => { clearTimeout(t); reject(e); });
    });

    volcWs.send(buildStartConnection());
    await waitForEvent(volcWs, ServerEvent.CONNECTION_STARTED, 5000);

    attachVolcHandlers();
  }

  attachVolcHandlers();

  browserWs.on("message", (data) => {
    if (!volcWs || volcWs.readyState !== WebSocket.OPEN) return;

    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === "audio" && msg.data) {
        if (!isAlive || isTransitioning) return;
        volcWs.send(buildSendAudio(volcSessionId, Buffer.from(msg.data, "hex")));
      } else if (msg.type === "text_input" && msg.content) {
        const userText = msg.content.trim();
        if (userText && !isTransitioning && !interviewDone) {
          updateUserLanguage(userText);
          questionTranscript.push({ role: "user", text: userText });
          userTurnsOnCurrentQ++;
          lastResponseWasCorrection = false;
          browserWs.send(JSON.stringify({ type: "interrupt" }));
          browserWs.send(JSON.stringify({ type: "asr_ended", text: userText }));

          if (pendingLastQuestionTimeout) {
            clearTimeout(pendingLastQuestionTimeout);
            pendingLastQuestionTimeout = null;
          }

          if (awaitingFinalResponse && !generatingResponse) {
            awaitingFinalResponse = false;
            if (finalResponseTimeout) {
              clearTimeout(finalResponseTimeout);
              finalResponseTimeout = null;
            }
            const farewell = buildFarewellSayHello(isZh);
            suppressModelOutput = true;
            awaitingSayHelloTts = true;
            skipNextTtsTranscript = true;
            volcWs.send(buildSayHello(volcSessionId, farewell));
            questionTranscript.push({ role: "assistant", text: farewell });
            pendingInterviewEnd = true;
          } else if (isUserEndRequest(userText)) {
            queueFarewellAndEnd(`Explicit interview end request (text): "${userText.slice(0, 80)}"`);
          } else if (isFastPrevRequest(userText) || isUserPrevRequest(userText)) {
            handlePreviousTransition().catch(log.error);
          } else if (isFastNextRequest(userText)) {
            handleTransition().catch(log.error);
          } else if (!generatingResponse) {
            const userWantsSkip = isUserSkipRequest(userText);
            suppressModelOutput = true;
            generatingResponse = true;
            generateControlledResponse({ forceSkip: userWantsSkip })
              .then((response) => {
                generatingResponse = false;
                if (!response || !volcWs || volcWs.readyState !== WebSocket.OPEN || !isAlive) {
                  suppressModelOutput = false;
                  return;
                }
                let shouldTransition = response.includes(NEXT_TOKEN);
                let shouldGoPrev = response.includes(PREV_TOKEN);
                const spokenText = response.replace(NEXT_TOKEN, "").replace(PREV_TOKEN, "").trim();

                if (!shouldTransition && !shouldGoPrev && userTurnsOnCurrentQ > 0
                    && hasImplicitTransition(spokenText) && !replyKeepsConversationOpen(spokenText, isZh)) {
                  shouldTransition = true;
                }

                if (!shouldGoPrev && !shouldTransition && hasImplicitPrevTransition(spokenText)) {
                  shouldGoPrev = true;
                }

                if (shouldTransition && !userWantsSkip && replyKeepsConversationOpen(spokenText, isZh)) {
                  shouldTransition = false;
                }
                const currentType = sortedQuestions[currentQuestionIndex]?.type;
                if (shouldTransition && !userWantsSkip && (currentType === "CODING" || currentType === "WHITEBOARD")) {
                  if (spokenText.length > 80) {
                    shouldTransition = false;
                  }
                }

                if (spokenText) {
                  awaitingSayHelloTts = true;
                  skipNextTtsTranscript = true;
                  volcWs.send(buildSayHello(volcSessionId, spokenText));
                  questionTranscript.push({ role: "assistant", text: spokenText });
                } else {
                  suppressModelOutput = false;
                }

                if (shouldGoPrev && !isTransitioning && !interviewDone && currentQuestionIndex > 0) {
                  if (spokenText) {
                    pendingPrevTransitionAfterTts = true;
                  } else {
                    handlePreviousTransition().catch(log.error);
                  }
                } else if (shouldTransition && !isTransitioning && !interviewDone) {
                  pendingTransitionAfterTts = true;
                }
              })
              .catch((err) => {
                log.error("Text response generation failed:", err);
                suppressModelOutput = false;
                generatingResponse = false;
                awaitingSayHelloTts = false;
              });
          }
        }
      } else if (msg.type === "next_question") {
        handleTransition().catch(log.error);
      } else if (msg.type === "prev_question") {
        handlePreviousTransition().catch(log.error);
      } else if (msg.type === "text" && msg.content) {
        volcWs.send(buildSayHello(volcSessionId, msg.content));
      } else if (msg.type === "code_update") {
        currentCodeContent = msg.content || "";
        currentCodeLanguage = msg.language || "plaintext";
      } else if (msg.type === "whiteboard_update") {
        const img = msg.imageDataUrl || "";
        if (img && img !== latestWhiteboardImage) {
          latestWhiteboardImage = img;
          whiteboardDirty = true;
        }
      } else if (msg.type === "ping") {
        browserWs.send(JSON.stringify({ type: "pong" }));
      }
    } catch (err) {
      log.error("Error handling browser message:", err);
    }
  });

  browserWs.on("close", () => {
    interviewDone = true;
    if (keepAliveInterval) { clearInterval(keepAliveInterval); keepAliveInterval = null; }
    if (finalResponseTimeout) clearTimeout(finalResponseTimeout);
    if (pendingLastQuestionTimeout) clearTimeout(pendingLastQuestionTimeout);
    if (isAlive && volcWs && volcWs.readyState === WebSocket.OPEN) {
      try {
        volcWs.send(buildFinishSession(volcSessionId));
        volcWs.send(buildFinishConnection());
      } catch { /* ignore */ }
    }
    volcWs?.removeAllListeners();
    volcWs?.close();
  });

  browserWs.on("error", (err) => {
    log.error(`Browser WS error: ${err.message}`);
  });

  keepAliveInterval = setInterval(() => {
    if (!isAlive || !volcWs || volcWs.readyState !== WebSocket.OPEN) return;
    volcWs.send(buildSendAudio(volcSessionId, Buffer.alloc(3200)));
  }, 2000);
}

// -- Helper: wait for a specific event

function waitForEvent(ws, targetEvent, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timeout waiting for event ${targetEvent}`)),
      timeoutMs
    );

    const handler = (data) => {
      try {
        const resp = parseResponse(Buffer.from(data));

        if (resp.event === targetEvent) {
          clearTimeout(timeout);
          ws.removeListener("message", handler);
          resolve();
        } else if (
          resp.messageType === SERVER_ERROR_RESPONSE ||
          resp.event === ServerEvent.SESSION_FAILED ||
          resp.event === ServerEvent.CONNECTION_FAILED
        ) {
          clearTimeout(timeout);
          ws.removeListener("message", handler);
          reject(new Error(`Server error`));
        }
      } catch (err) {
        log.error("Parse error in handshake:", err);
      }
    };

    ws.on("message", handler);
  });
}
