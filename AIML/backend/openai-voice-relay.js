/**
 * Backup voice relay using Azure OpenAI Realtime API (gpt-realtime-1.5).
 *
 * Browser ←→ this relay ←→ Azure OpenAI Realtime API
 */

import { randomUUID } from "crypto";
import { config } from "dotenv";
import { WebSocket, WebSocketServer } from "ws";
import { createLogger } from "../frontend/src/lib/logger.js";
import {
  BIGMODEL_ASR_URL,
  buildBigModelAudioRequest,
  buildBigModelFullRequest,
  buildBigModelHeaders,
  parseAsrResponse,
} from "./volcengine-asr.js";
import {
  DEFAULT_TTS_BARGE_IN_MIN_AUDIO_BYTES,
  DEFAULT_TTS_BARGE_IN_MIN_AUDIO_MS,
  shouldAllowTtsBargeIn,
} from "./openai-voice-relay-helpers.js";

const log = createLogger("openai-relay");

config({ path: ".env.local", override: true });
config({ path: ".env" });

// -- Configuration

const RELAY_PORT =
  Number(process.env.OPENAI_VOICE_RELAY_PORT || process.env.VOICE_RELAY_PORT) ||
  8767;
const AZURE_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT || "";
const AZURE_API_KEY = process.env.AZURE_OPENAI_API_KEY || "";
const AZURE_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-realtime-1.5";
const AZURE_VOICE = (process.env.AZURE_OPENAI_VOICE || "ash").toLowerCase();
const OPENAI_REALTIME_TRANSCRIPTION_MODEL =
  process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL || "whisper-1";

const DIRECT_OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const USE_AZURE = !!(AZURE_ENDPOINT && AZURE_API_KEY);
const USE_DIRECT_OPENAI = !USE_AZURE && !!DIRECT_OPENAI_API_KEY;

const DIRECT_OPENAI_MODEL =
  process.env.OPENAI_REALTIME_MODEL || "gpt-4o-mini-realtime-preview-2024-12-17";
const OPENAI_WS_URL = USE_AZURE
  ? `${AZURE_ENDPOINT}/openai/v1/realtime?model=${AZURE_DEPLOYMENT}`
  : `wss://api.openai.com/v1/realtime?model=${DIRECT_OPENAI_MODEL}`;
const OPENAI_WS_HEADERS = USE_AZURE
  ? { "api-key": AZURE_API_KEY }
  : { "Authorization": `Bearer ${DIRECT_OPENAI_API_KEY}`, "OpenAI-Beta": "realtime=v1" };

if (!USE_AZURE && !USE_DIRECT_OPENAI) {
  log.error("Missing voice API credentials. Set either AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_API_KEY, or OPENAI_API_KEY in .env");
  process.exit(1);
}
log.info(`Using ${USE_AZURE ? "Azure OpenAI" : "Direct OpenAI"} backend`);

const VOLC_ASR_APPID = process.env.DOUBAO_APP_ID || "";
const VOLC_ASR_TOKEN = process.env.DOUBAO_ACCESS_TOKEN || "";
const VOLC_ASR_AVAILABLE = !!(VOLC_ASR_APPID && VOLC_ASR_TOKEN);
const ASR_PRIMARY = (process.env.VOICE_ASR_PRIMARY || "openai").toLowerCase();
const USE_VOLC_ASR_PRIMARY = VOLC_ASR_AVAILABLE && ASR_PRIMARY === "volc";
const USE_VOLC_ASR_INTERIMS = VOLC_ASR_AVAILABLE;

const MIN_AUDIO_RMS = 160;
const CONTINUATION_AUDIO_RMS = 100;
const TTS_BARGE_IN_RMS = 2400;
const TTS_BARGE_IN_FRAME_COUNT = 3;

const WHISPER_HALLUCINATIONS = new Set([
  "thank you.", "thank you", "thanks.", "thanks",
  "thank you for watching.", "thanks for watching.",
  "bye.", "bye", "goodbye.", "goodbye",
  "you", "the end.", "subscribe.",
  ".", "..", "...", " ",
]);

function isWhisperHallucination(text) {
  const trimmed = text.trim().toLowerCase();
  return trimmed.length === 0 || WHISPER_HALLUCINATIONS.has(trimmed);
}

function looksLikeFarewell(text, isZh) {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  if (/[?？]/.test(normalized)) return false;

  const zhPatterns = [
    /再见/, /保重/, /一路顺利/, /祝你(?:一切顺利|顺利|好运)/,
    /感谢你今天的参与/, /祝你未来(?:的)?面试顺利/,
  ];
  const enPatterns = [
    /\bgood\s*bye\b/, /\bgoodbye\b/, /\bbye for now\b/,
    /\bthat'?s all for now\b/, /\ball for now\b/, /\btake care\b/,
    /\bbest of luck\b/, /\bwish you (?:the )?best\b/,
    /\bthank you (?:so much )?for your time\b/, /\bfuture interviews\b/,
  ];

  const patterns = isZh ? [...zhPatterns, ...enPatterns] : [...enPatterns, ...zhPatterns];
  return patterns.some((pattern) => pattern.test(normalized));
}

function mergeAsrText(previous, incoming) {
  const prev = previous.trim();
  const next = incoming.trim();
  if (!next) return prev;
  if (!prev) return next;

  const prevLower = prev.toLowerCase();
  const nextLower = next.toLowerCase();

  if (nextLower.includes(prevLower)) return next;
  if (prevLower.includes(nextLower)) return prev;

  if (next.length + 8 < prev.length) return prev;

  return next.length >= prev.length ? next : prev;
}

const FAST_NEXT_PATTERNS = [
  /^(?:下一个问题|下一题|跳过|next\s*question|skip)\.?$/i,
];

const FAST_PREV_PATTERNS = [
  /^(?:上一个问题|上一题|previous\s*question)\.?$/i,
];

const USER_SKIP_PATTERNS = [
  /(?:let'?s|please|can\s+(?:we|you))\s+(?:move\s+on|skip|proceed|go\s+to\s+(?:the\s+)?next)/i,
  /move\s+on(?:\s+to)?/i,
  /continue\s+to\s+(?:the\s+)?next/i,
  /go\s+(?:on\s+)?to\s+(?:the\s+)?next/i,
  /skip\s+(?:this|the)\s+(?:question|one|problem)/i,
  /I\s+(?:give\s+up|want\s+to\s+skip|'?d\s+like\s+to\s+skip)/i,
  /next\s+question/i,
  /please\s+(?:move\s+on|skip)/i,
  /(?:跳过|下一(?:个问题|题)|不做了|放弃了?|结束吧|请继续(?:下一|到下))/,
  /(?:我不会|不想做了|不想答了|过吧|换下一)/,
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

function isFastNextRequest(text) {
  const trimmed = text.trim();
  return FAST_NEXT_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function isFastPrevRequest(text) {
  const trimmed = text.trim();
  return FAST_PREV_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function isUserSkipRequest(text) {
  return USER_SKIP_PATTERNS.some((pattern) => pattern.test(text));
}

function isUserPrevRequest(text) {
  return USER_PREV_PATTERNS.some((pattern) => pattern.test(text));
}

const CODING_DONE_PATTERNS = [
  /\bi(?:'m| am)\s+done\b/i,
  /\bi\s+finished\b/i,
  /\bit'?s\s+done\b/i,
  /\bthat'?s\s+done\b/i,
  /\bfinished\s+it\b/i,
  /\bdone\s+with\s+(?:it|this|the code|the problem)\b/i,
];

function isCodingDoneSignal(text) {
  return CODING_DONE_PATTERNS.some((pattern) => pattern.test(text.trim()));
}

function isChineseInterview(ctx) {
  return ctx.language === "zh" || ctx.language.toLowerCase().includes("chinese");
}

function resample16to24(input) {
  const inputSamples = input.length / 2;
  const outputSamples = Math.floor((inputSamples * 3) / 2);
  const out = Buffer.alloc(outputSamples * 2);
  const ratio = inputSamples / outputSamples;

  for (let o = 0; o < outputSamples; o++) {
    const srcIdx = o * ratio;
    const idx0 = Math.floor(srcIdx);
    const idx1 = Math.min(idx0 + 1, inputSamples - 1);
    const frac = srcIdx - idx0;
    const s0 = input.readInt16LE(idx0 * 2);
    const s1 = input.readInt16LE(idx1 * 2);
    const sample = Math.round(s0 + (s1 - s0) * frac);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), o * 2);
  }
  return out;
}

function int16ToFloat32(buf) {
  const samples = buf.length / 2;
  const out = Buffer.alloc(samples * 4);
  for (let i = 0; i < samples; i++) {
    out.writeFloatLE(buf.readInt16LE(i * 2) / 32768, i * 4);
  }
  return out;
}

function buildSystemPrompt(ctx, startIdx) {
  const isZh = isChineseInterview(ctx);
  const sorted = ctx.questions.sort((a, b) => a.order - b.order);

  let maxFollowUps;
  switch (ctx.followUpDepth) {
    case "LIGHT":    maxFollowUps = 1; break;
    case "MODERATE": maxFollowUps = 3; break;
    case "DEEP":     maxFollowUps = 5; break;
    default:         maxFollowUps = 2;
  }

  const questionList = sorted.map((q, i) => {
    let entry = `  ${i + 1}. [${q.type}] ${q.text}`;
    if (q.description) entry += `\n     Context: ${q.description}`;
    if (q.options?.options?.length) {
      const labels = q.options.options.map((o, j) => `${String.fromCharCode(65 + j)}) ${o}`).join(", ");
      const multi = q.options.allowMultiple ? " (multiple choice)" : " (single choice)";
      entry += `\n     Options${multi}: ${labels}`;
    }
    if (q.type === "CODING") entry += `\n     Note: The participant has a code editor. You cannot see their code unless they describe it.`;
    if (q.type === "WHITEBOARD") entry += `\n     Note: The participant has a whiteboard. You will receive image updates silently — do NOT speak when you receive them. Only describe what you see when the participant asks you to look at it.`;
    return entry;
  }).join("\n");

  const currentQ = startIdx + 1;

  if (isZh) {
    return `你是"${ctx.aiName}"，一位${ctx.aiTone}的AI面试官。

## 面试信息
- 主题: "${ctx.title}"
${ctx.objective ? `- 目标: ${ctx.objective}` : ""}
- 问题数量: ${sorted.length}
- 当前问题: 第${currentQ}个
- 每题追问深度: 最多${maxFollowUps}次追问

## 问题列表
${questionList}

## 你的行为准则
1. 从第${currentQ}个问题开始。先用温暖友好的方式自我介绍（提到你的名字、面试主题和问题数量）。然后说一句过渡语，比如"我们开始吧，这是第一个问题。"之后再提出问题。问候、过渡语和问题必须是三个独立的句子，不要合并。
2. 对每个问题，根据受访者的回答进行${maxFollowUps}次以内的追问。语气要像友好、耐心的真人面试官，而不是冷冰冰地连珠发问。
3. 当一个问题讨论充分后，调用 signal_question_change 函数来进入下一个问题。"讨论充分"是指受访者给出了详细、具体的回答——不是模糊的表述如"我遇到过很多挑战"。如果回答模糊，应追问以获取更多细节。
4. 切换后，自然地过渡到新问题。通常先用一句简短的认可或感谢来承接上一段回答，再进入下一题，而不是直接生硬地抛出问题。
5. 所有问题结束后，调用 signal_question_change 并设 questionIndex 为 ${sorted.length}（超出范围），然后做简短总结告别。
6. 保持对话自然流畅，回复简洁（1-3句话）。语速要平缓，略慢于日常对话，让受访者能轻松跟上。可以使用简短友好的衔接语，比如"谢谢你的分享"、"我明白了"、"这很有帮助"。
7. 如果受访者要求"跳过"或"下一题"，简短回应后立即调用 signal_question_change 并设 userRequested=true。
8. 如果受访者要求"上一题"，调用 signal_question_change 并设 questionIndex 为上一题的索引，设 userRequested=true。

## 选择题的特殊规则
当提问单选题或多选题时，你必须把所有选项（A、B、C等）逐一朗读出来作为问题的一部分。受访者只能听到你说话——如果你不说出选项，他们就无法知道有哪些选择。列出选项后，请受访者选择并解释理由。对于多选题，提醒他们可以选择多个选项。

## 编程题/白板题的特殊规则
当进入编程题或白板题时：
- 不要朗读完整的题目内容！题目详情已经显示在受访者的屏幕上。只需简短说明这是编程题/白板题，请他们查看屏幕上的题目并使用编辑器/白板。
- 回复要保持简短，让受访者专注于思考和编码/绘画。
- 受访者的发言分为以下几类，请对应回复：
  1. 向你提问或对话 → 正常回应
  2. 说"完成了"/"做好了" → 请他们解释思路、复杂度和可能的优化
  3. 自言自语或思考中 → 只用非常简短的鼓励（如"好的，继续"）
  4. 明确要跳过/放弃 → 简短鼓励后调用 signal_question_change
  5. 讨论已自然结束 → 简短感谢后调用 signal_question_change

## 语言要求
- 你必须始终用中文进行面试。你必须用中文回答。不要使用其他语言。

## 代码和白板可见性
- 你可以看到受访者的代码和白板内容！系统会通过 [CODE_UPDATE] 和 [WHITEBOARD_UPDATE] 消息将受访者编辑器中的代码和白板图片实时发送给你。
- 当受访者问你"能看到我的代码吗"或"看一下我写的"时，回答"是"并参考你收到的最新代码/白板内容。
- 不要在收到更新时主动开口——只在受访者和你说话时才提及。

## 重要规则
- 必须通过 signal_question_change 函数来切换问题。不要只口头说"让我们进入下一题"而不调用函数。
- 如果受访者只是简单打招呼、确认性问题或模糊回答（如"你好"、"能听到吗?"、"我遇到过很多挑战"），先友好回应，再继续当前问题；不要调用 signal_question_change。这些不是实质性回答。必须等受访者给出详细、具体的回答后再切换。如果回答太简短或模糊，应追问以获取更多信息。
- 始终关注当前问题，不要跳到其他话题。
- 对于选择题，确保受访者给出选择并解释理由。
- 当受访者让你看白板时，描述你看到的内容并给出反馈。不要在收到图片更新时自动开口说话。`;
  }

  return `You are "${ctx.aiName}", a ${ctx.aiTone} AI interviewer.

## Interview Details
- Topic: "${ctx.title}"
${ctx.objective ? `- Objective: ${ctx.objective}` : ""}
- Total questions: ${sorted.length}
- Starting at: Question ${currentQ}
- Follow-up depth: Up to ${maxFollowUps} follow-ups per question

## Questions
${questionList}

## Your Behavior
1. Start at question ${currentQ}. First, give a warm greeting — introduce yourself by name, mention the topic "${ctx.title}" and that there are ${sorted.length} questions. Then say a transition phrase like "Let's get started. Here is the first question." ONLY AFTER that, ask the question. The greeting, the transition phrase, and the question MUST be three separate sentences — NEVER combine them into one.
2. For each question, follow up based on the participant's answers (up to ${maxFollowUps} follow-ups). Sound like a warm, patient human interviewer, not a rapid-fire questionnaire.
3. When a question is sufficiently discussed, call the signal_question_change function to move forward. "Sufficiently discussed" means the participant has given a detailed, specific answer — NOT a vague statement like "I had many challenges" or "that's a good question." If their answer is vague, ask them to elaborate before moving on.
4. After transitioning, naturally introduce the next question. Usually start with a short acknowledgement or appreciation of the participant's last answer before asking the next question.
5. After all questions are done, call signal_question_change with questionIndex=${sorted.length} (out of bounds), then give a brief wrap-up and farewell.
6. Keep responses concise (1-3 sentences) and conversational. Speak at a calm, unhurried pace — slightly slower than normal conversation speed so the participant can follow easily. Use brief friendly bridges like "Thanks for sharing that", "I appreciate the context", or "That makes sense" when appropriate.
7. If the participant asks to "skip" or "next question", briefly acknowledge and immediately call signal_question_change with userRequested=true.
8. If the participant asks for "previous question", call signal_question_change with the previous question's index and userRequested=true.

## Special Rules for Choice Questions
When asking a SINGLE_CHOICE or MULTIPLE_CHOICE question, you MUST read out ALL the answer options (A, B, C, etc.) as part of asking the question. The participant can only hear you — they cannot see the options unless you say them. After listing the options, ask the participant to choose and explain their reasoning. For multiple-choice questions, remind them they can select more than one option.

## Special Rules for Coding / Whiteboard Questions
When transitioning to a CODING or WHITEBOARD question:
- Do NOT read out the full question text! The question details are already displayed on the participant's screen. Just briefly say it's a coding/whiteboard question and ask them to read the problem on their screen and use the code editor/whiteboard.
- Keep your responses short — let the participant focus on thinking and coding/drawing.
- Categorize the participant's speech and respond accordingly:
  1. Talking TO YOU (asking questions, discussing approach) → Respond naturally
  2. Saying they're DONE ("I'm done", "finished") → Ask about their approach, time/space complexity, and possible improvements
  3. Thinking ALOUD (self-talk, "hmm", reading code) → Brief encouragement only (e.g. "Take your time")
  4. Wanting to SKIP ("I can't do this", "skip", "next question") → Brief encouragement, then call signal_question_change
  5. Discussion naturally CONCLUDED → Brief acknowledgement, then call signal_question_change

## Language Requirements
- YOU MUST ALWAYS RESPOND IN ENGLISH. You must conduct this interview entirely in English. Do not switch to any other language under any circumstance.

## Code and Whiteboard Visibility
- You CAN see the participant's code and whiteboard! The system sends you real-time updates via [CODE_UPDATE] and [WHITEBOARD_UPDATE] messages containing their editor code and whiteboard images.
- When the participant asks "can you see my code?" or "look at what I wrote", answer YES and reference the latest code/whiteboard content you received.
- Do NOT proactively speak when you receive an update — only reference the content when the participant addresses you.

## Important Rules
- You MUST use the signal_question_change function to transition between questions. NEVER verbally say "let's move on" without also calling the function — the UI only updates when the function is called.
- Do NOT call signal_question_change if the participant has only said a brief greeting, clarifying remark, or vague statement (e.g. "hi", "can you hear me?", "I had many challenges"). First respond warmly and helpfully, then continue the current question. These are NOT substantive answers. You MUST wait for a detailed, specific response that actually addresses the question before moving on. If their answer is too brief or vague, probe deeper.
- Stay focused on the current question. Do not jump to unrelated topics.
- For choice questions, ensure the participant both selects an option AND explains their reasoning.
- When the participant asks you to look at the whiteboard, describe what you see and give feedback. Do NOT automatically start speaking when you receive a whiteboard image update — wait for the participant to address you.`;
}

const OPENAI_TOOLS = [{
  type: "function",
  name: "signal_question_change",
  description: "Signal that the interview should move to a different question. Call this ONLY when the current question has been substantively discussed (the participant gave a real, detailed answer — NOT a vague statement like 'I had many challenges'), or when the participant explicitly asks to skip/go back. Do NOT call this after a brief greeting or clarification like 'can you hear me'. After calling, naturally introduce the next question in your spoken response.",
  parameters: {
    type: "object",
    properties: {
      questionIndex: {
        type: "integer",
        description: "Zero-based index of the question to move to. Use current+1 for next, current-1 for previous, or total_questions to signal interview end.",
      },
      userRequested: {
        type: "boolean",
        description: "Set to true ONLY if the participant explicitly asked to skip, go to next/previous question, or go back. Set to false (or omit) when you are transitioning because the discussion is complete.",
      },
    },
    required: ["questionIndex"],
  },
}];

const wss = new WebSocketServer({ port: RELAY_PORT });
log.info(`OpenAI voice relay listening on ws://localhost:${RELAY_PORT}`);

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
        handleMicTest(browserWs);
      } else if (msg.type === "init" && msg.context) {
        clearTimeout(timeout);
        browserWs.removeListener("message", handler);
        handleInterview(browserWs, msg.context);
      }
    } catch { /* ignore */ }
  };
  browserWs.on("message", handler);
});

async function handleMicTest(browserWs) {
  log.info(`Mic test mode (${USE_VOLC_AS_PRIMARY ? "Volcengine" : "OpenAI"})`);

  let oaiWs = null;
  let volcWs = null;
  let volcAlive = false;
  let volcAudioSeq = 1;
  let volcKeepAliveTimer = null;

  const autoTimeout = setTimeout(() => {
    if (browserWs.readyState === WebSocket.OPEN)
      browserWs.send(JSON.stringify({ type: "timeout" }));
    cleanup();
  }, 20_000);

  function cleanup() {
    clearTimeout(autoTimeout);
    if (volcKeepAliveTimer) { clearInterval(volcKeepAliveTimer); volcKeepAliveTimer = null; }
    if (volcWs && volcWs.readyState === WebSocket.OPEN) {
      try {
        volcAudioSeq++;
        volcWs.send(buildBigModelAudioRequest(Buffer.alloc(0), volcAudioSeq, true));
      } catch { /* ignore */ }
    }
    volcWs?.close();
    volcWs = null;
    volcAlive = false;
    oaiWs?.close();
    oaiWs = null;
  }

  async function connectMicTestVolcAsr() {
    const reqid = randomUUID().replace(/-/g, "");
    const asrConfig = {
      format: "pcm", rate: 16000, bits: 16, channels: 1, codec: "raw",
      showUtterance: true, resultType: "single", enablePunc: true,
      endWindowSize: 500, forceToSpeechTime: 1000,
    };

    const wsHeaders = buildBigModelHeaders(VOLC_AS_APPID, VOLC_AS_TOKEN, reqid);
    volcWs = new WebSocket(BIGMODEL_ASR_URL, { headers: wsHeaders });

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Volcengine ASR connect timeout")), 10_000);
      volcWs.on("open", () => { clearTimeout(t); resolve(); });
      volcWs.on("error", (e) => { clearTimeout(t); reject(e); });
    });

    let micAsrAccum = "";
    volcWs.on("message", (data) => {
      try {
        const resp = parseAsrResponse(Buffer.from(data));
        if (resp.messageType === 0x0b) {
          if (!volcAlive) { volcAlive = true; log.info("Mic test Volcengine ASR connected"); }
          return;
        }
        if (resp.errorCode || (resp.code && resp.code !== 1000)) {
          return;
        }
        if (!volcAlive) return;

        if (resp.utterances?.length) {
          const utt = resp.utterances[0];
          if (utt.text) {
            micAsrAccum = utt.text;
            if (browserWs.readyState === WebSocket.OPEN) {
              browserWs.send(JSON.stringify({ type: "asr", data: { results: [{ text: micAsrAccum }] } }));
            }
          }
          if (utt.definite && micAsrAccum.trim()) {
            if (browserWs.readyState === WebSocket.OPEN) {
              browserWs.send(JSON.stringify({ type: "asr_ended" }));
            }
            micAsrAccum = "";
          }
        } else if (resp.text) {
          micAsrAccum = resp.text;
          if (browserWs.readyState === WebSocket.OPEN) {
            browserWs.send(JSON.stringify({ type: "asr", data: { results: [{ text: micAsrAccum }] } }));
          }
          if (resp.isLastPackage && micAsrAccum.trim()) {
            if (browserWs.readyState === WebSocket.OPEN) {
              browserWs.send(JSON.stringify({ type: "asr_ended" }));
            }
            micAsrAccum = "";
          }
        }
      } catch (err) { log.error("Mic test Volc ASR parse error:", err); }
    });

    volcWs.send(buildBigModelFullRequest(asrConfig, reqid));
    volcAlive = true;

    volcKeepAliveTimer = setInterval(() => {
      if (!volcAlive || !volcWs || volcWs.readyState !== WebSocket.OPEN) return;
      volcAudioSeq++;
      volcWs.send(buildBigModelAudioRequest(Buffer.alloc(3200), volcAudioSeq));
    }, 5_000);
  }

  async function connectMicTestOpenAI() {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        oaiWs = new WebSocket(OPENAI_WS_URL, { headers: OPENAI_WS_HEADERS });
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error("OpenAI connect timeout")), 10_000);
          oaiWs.on("open", () => { clearTimeout(t); resolve(); });
          oaiWs.on("error", (e) => { clearTimeout(t); reject(e); });
        });
        break;
      } catch (err) {
        if (attempt < 2) {
          oaiWs?.close(); oaiWs = null;
          await new Promise((r) => setTimeout(r, 1_000));
        } else { throw err; }
      }
    }

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Session create timeout")), 10_000);
      const h = (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "session.created") { clearTimeout(t); oaiWs.removeListener("message", h); resolve(); }
        } catch { /* ignore */ }
      };
      oaiWs.on("message", h);
    });

    const micTestSessionConfig = USE_DIRECT_OPENAI ? {
      modalities: ["audio", "text"],
      instructions: "You are a mic test assistant. Listen to the user and confirm what you hear. Keep responses very short.",
      voice: AZURE_VOICE,
      input_audio_format: "pcm16",
      output_audio_format: "pcm16",
      input_audio_transcription: { model: OPENAI_REALTIME_TRANSCRIPTION_MODEL },
      turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 300 },
    } : {
      type: "realtime",
      instructions: "You are a mic test assistant. Listen to the user and confirm what you hear. Keep responses very short.",
      output_modalities: ["audio"],
      audio: {
        input: {
          format: { type: "audio/pcm", rate: 24000 },
          noise_reduction: { type: "far_field" },
          transcription: { model: OPENAI_REALTIME_TRANSCRIPTION_MODEL },
          turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 300 },
        },
        output: { format: { type: "audio/pcm", rate: 24000 }, voice: AZURE_VOICE },
      },
    };

    oaiWs.send(JSON.stringify({ type: "session.update", session: micTestSessionConfig }));

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Session update timeout")), 10_000);
      const h = (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "session.updated") { clearTimeout(t); oaiWs.removeListener("message", h); resolve(); }
          else if (msg.type === "error") { clearTimeout(t); oaiWs.removeListener("message", h); reject(new Error(`Session update error`)); }
        } catch { /* ignore */ }
      };
      oaiWs.on("message", h);
    });

    let micTestAsrBuffer = "";
    oaiWs.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "conversation.item.input_audio_transcription.completed") {
          micTestAsrBuffer = msg.transcript || "";
          if (browserWs.readyState === WebSocket.OPEN) {
            browserWs.send(JSON.stringify({ type: "asr", data: { results: [{ text: micTestAsrBuffer.trim() }] } }));
          }
        }
        if (msg.type === "conversation.item.input_audio_transcription.delta") {
          micTestAsrBuffer += msg.delta || "";
          if (browserWs.readyState === WebSocket.OPEN) {
            browserWs.send(JSON.stringify({ type: "asr", data: { results: [{ text: micTestAsrBuffer.trim() }] } }));
          }
        }
        if (msg.type === "response.done") {
          if (browserWs.readyState === WebSocket.OPEN) {
            browserWs.send(JSON.stringify({ type: "asr_ended" }));
          }
          micTestAsrBuffer = "";
        }
      } catch { /* ignore */ }
    });
  }

  try {
    if (USE_VOLC_ASR_PRIMARY) {
      await connectMicTestVolcAsr();
    } else {
      await connectMicTestOpenAI();
    }

    browserWs.send(JSON.stringify({ type: "ready" }));

    browserWs.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type !== "audio" || !msg.data) return;
        const pcm16k = Buffer.from(msg.data, "hex");

        if (volcAlive && volcWs && volcWs.readyState === WebSocket.OPEN) {
          volcAudioSeq++;
          volcWs.send(buildBigModelAudioRequest(pcm16k, volcAudioSeq));
        }

        if (oaiWs && oaiWs.readyState === WebSocket.OPEN) {
          const pcm24k = resample16to24(pcm16k);
          oaiWs.send(JSON.stringify({
            type: "input_audio_buffer.append",
            audio: pcm24k.toString("base64"),
          }));
        }
      } catch { /* ignore */ }
    });

    browserWs.on("close", () => {
      cleanup();
    });
  } catch (err) {
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(JSON.stringify({ type: "error", message: `Mic test failed` }));
    }
    browserWs.close();
    cleanup();
  }
}

async function handleInterview(browserWs, ctx) {
  const sortedQuestions = ctx.questions.sort((a, b) => a.order - b.order);
  const isZh = isChineseInterview(ctx);
  let currentQuestionIndex = ctx.startQuestionIndex ?? 0;
  let questionEnteredAt = Date.now();
  const MIN_QUESTION_DWELL_MS = 15_000;
  const MIN_WORDS_BEFORE_TRANSITION = 20;
  let userCommittedWordsThisQuestion = 0;
  let toolsEnabled = true;
  let interviewDone = false;
  let oaiWs = null;
  let oaiSessionStart = Date.now();
  let reconnecting = false;
  let browserClosed = false;

  let inputTranscriptBuffer = "";
  let outputTranscriptBuffer = "";
  let modelIsSpeaking = false;
  let lastOaiActivity = Date.now();
  let lastUserInput = 0;
  let lastVadSpeechEnd = 0;
  let vadSpeechActive = false;
  let lastTtsAudioTime = 0;
  const TTS_ECHO_COOLDOWN_MS = 1500;
  let isTransitioning = false;
  let pendingInterviewComplete = false;
  let interviewCompleteTimer = null;
  let emptyResponseRetries = 0;
  const MAX_EMPTY_RETRIES = 2;
  let responseTtsBytes = 0;
  let responseAudioStarted = false;
  let responseAudioStartedAt = 0;
  let pendingTtsText = [];
  let queuedAssistantResponse = null;

  const USER_INPUT_FLUSH_MS = 3000;
  let pendingInputFlush = null;
  let pendingAsrUpdate = null;

  let pendingFunctionCalls = [];

  function flushUserInput() {
    if (pendingInputFlush) { clearTimeout(pendingInputFlush); pendingInputFlush = null; }
    const committedText = commitUserTranscript("flush");
    if (committedText) {
      handleCommittedUserText(committedText, "flush");
    }
  }

  function scheduleInputFlush() {
    if (pendingInputFlush) clearTimeout(pendingInputFlush);
    pendingInputFlush = setTimeout(() => {
      pendingInputFlush = null;
      flushUserInput();
    }, USER_INPUT_FLUSH_MS);
  }

  let latestCode = "";
  let latestCodeLanguage = "plaintext";
  let openAiTranscriptionEnabled = true;
  let pendingSpeechFinalize = null;
  let speechTranscriptCommitted = false;
  let responseInFlight = false;

  let pendingQuestionPrompt = null;
  let pendingPromptTimer = null;
  let lastTranscriptUpdateAt = 0;
  const USER_TRANSCRIPT_STABILITY_MS = 900;
  const USER_TRANSCRIPT_MAX_WAIT_MS = 4500;
  const USER_TURN_SPLIT_SILENCE_MS = 1200;
  const USER_SPEECH_STOP_FINALIZE_MS = 1600;
  const SPEECH_STOP_FORWARD_GRACE_MS = 1400;
  const STALE_ASR_GUARD_MS = 1500;
  let staleAsrGuardText = "";
  let staleAsrGuardUntil = 0;
  let speechStopForwardGraceUntil = 0;
  let ttsBargeInFrames = 0;

  const conversationHistory = [];
  const MAX_HISTORY_ENTRIES = 30;

  function pushHistory(role, text) {
    if (!text.trim()) return;
    if (role === "user" && !text.startsWith("[")) {
      userCommittedWordsThisQuestion += text.trim().split(/\s+/).length;
      if (!toolsEnabled && userCommittedWordsThisQuestion >= MIN_WORDS_BEFORE_TRANSITION) {
        enableTools();
      }
    }
    conversationHistory.push({ role, text: text.trim() });
    while (conversationHistory.length > MAX_HISTORY_ENTRIES) {
      conversationHistory.shift();
    }
  }

  function enableTools() {
    if (toolsEnabled || !oaiWs || oaiWs.readyState !== WebSocket.OPEN) return;
    toolsEnabled = true;
    oaiWs.send(JSON.stringify({
      type: "session.update",
      session: { type: "realtime", tool_choice: "auto" },
    }));
  }

  function disableTools() {}

  let pendingTransitionTimer = null;

  function send(msg) {
    if (browserWs.readyState === WebSocket.OPEN)
      browserWs.send(JSON.stringify(msg));
  }

  function sendBinary(buf) {
    if (browserWs.readyState === WebSocket.OPEN)
      browserWs.send(buf, { binary: true });
  }

  function clearPendingTransition() {
    if (pendingTransitionTimer) {
      clearTimeout(pendingTransitionTimer);
      pendingTransitionTimer = null;
    }
  }

  function sendQuestionPrompt(prompt, retriesLeft = 2) {
    pendingQuestionPrompt = prompt;
    if (pendingPromptTimer) clearTimeout(pendingPromptTimer);

    if (oaiWs?.readyState === WebSocket.OPEN && !reconnecting) {
      oaiWs.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [{ type: "input_text", text: prompt }],
        },
      }));
      requestAssistantResponse("question prompt");
    }

    pendingPromptTimer = setTimeout(() => {
      if (!pendingQuestionPrompt) return;
      if (retriesLeft > 0 && !browserClosed && !interviewDone) {
        sendQuestionPrompt(prompt, retriesLeft - 1);
      } else {
        pendingQuestionPrompt = null;
      }
    }, 5_000);
  }

  function clearQuestionPrompt() {
    pendingQuestionPrompt = null;
    if (pendingPromptTimer) {
      clearTimeout(pendingPromptTimer);
      pendingPromptTimer = null;
    }
  }

  function cancelOngoingResponse() {
    const shouldCancel = responseInFlight || responseAudioStarted || modelIsSpeaking || !!outputTranscriptBuffer;
    if (shouldCancel && oaiWs && oaiWs.readyState === WebSocket.OPEN) {
      responseInFlight = false;
      oaiWs.send(JSON.stringify({ type: "response.cancel" }));
    }
    outputTranscriptBuffer = "";
    pendingTtsText = [];
    responseTtsBytes = 0;
    responseAudioStarted = false;
    responseAudioStartedAt = 0;
    modelIsSpeaking = false;
  }

  function requestAssistantResponse(reason, response) {
    if (!oaiWs || oaiWs.readyState !== WebSocket.OPEN || reconnecting || isTransitioning || (interviewDone && !pendingInterviewComplete)) {
      return;
    }
    if (responseInFlight) {
      queuedAssistantResponse = { reason, response };
      return;
    }
    const payload = response ? { type: "response.create", response } : { type: "response.create" };
    responseInFlight = true;
    oaiWs.send(JSON.stringify(payload));
  }

  function takeQueuedAssistantResponse() {
    const next = queuedAssistantResponse;
    queuedAssistantResponse = null;
    return next;
  }

  function normalizeAsrGuardText(text) {
    return text.toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function shouldIgnoreStaleAsrText(text) {
    if (!staleAsrGuardText || Date.now() > staleAsrGuardUntil) return false;
    const incoming = normalizeAsrGuardText(text);
    const previous = normalizeAsrGuardText(staleAsrGuardText);
    if (!incoming || !previous) return false;
    if (incoming === previous) return true;
    if (incoming.length >= 8 && previous.includes(incoming)) return true;
    if (previous.length >= 8 && incoming.includes(previous)) return true;
    return false;
  }

  function armStaleAsrGuard(text) {
    staleAsrGuardText = text;
    staleAsrGuardUntil = Date.now() + STALE_ASR_GUARD_MS;
  }

  function clearStaleAsrGuard() {
    staleAsrGuardText = "";
    staleAsrGuardUntil = 0;
  }

  function shouldSplitUserTurnOnSpeechStart(now = Date.now()) {
    return !speechTranscriptCommitted && !!bestAvailableTranscript() && !!lastVadSpeechEnd && now - lastVadSpeechEnd >= USER_TURN_SPLIT_SILENCE_MS;
  }

  function handleCommittedUserText(committedText, reason) {
    if (tryHandleExplicitUserNavigation(committedText)) return true;
    const currentQuestion = sortedQuestions[currentQuestionIndex];
    if (currentQuestion && (currentQuestion.type === "CODING" || currentQuestion.type === "WHITEBOARD") && isCodingDoneSignal(committedText) && oaiWs && oaiWs.readyState === WebSocket.OPEN) {
      oaiWs.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [{ type: "input_text", text: "[SYSTEM] The participant just said they are done. Ask them to walk through their solution." }],
        },
      }));
    }
    requestAssistantResponse(reason);
    return false;
  }

  function clearSpeechFinalizeTimer() {
    if (pendingSpeechFinalize) { clearTimeout(pendingSpeechFinalize); pendingSpeechFinalize = null; }
  }

  function bestAvailableTranscript() {
    return mergeAsrText(inputTranscriptBuffer, volcAsrAccumulator).trim();
  }

  function noteTranscriptUpdate() {
    lastTranscriptUpdateAt = Date.now();
    if (!vadSpeechActive && !speechTranscriptCommitted && bestAvailableTranscript()) {
      scheduleSpeechFinalize("asr stability", USER_TRANSCRIPT_STABILITY_MS);
    }
  }

  function transcriptLooksStable(now = Date.now()) {
    if (!lastTranscriptUpdateAt) return true;
    const sinceUpdate = now - lastTranscriptUpdateAt;
    const sinceSpeechStop = lastVadSpeechEnd ? now - lastVadSpeechEnd : Number.POSITIVE_INFINITY;
    return sinceUpdate >= USER_TRANSCRIPT_STABILITY_MS || sinceSpeechStop >= USER_TRANSCRIPT_MAX_WAIT_MS;
  }

  function commitUserTranscript(reason) {
    clearSpeechFinalizeTimer();
    if (speechTranscriptCommitted) return "";
    const committedText = bestAvailableTranscript();
    if (!committedText) return "";
    speechTranscriptCommitted = true;
    pushHistory("user", committedText);
    send({ type: "asr_ended", text: committedText });
    inputTranscriptBuffer = "";
    volcAsrAccumulator = "";
    lastTranscriptUpdateAt = 0;
    armStaleAsrGuard(committedText);
    return committedText;
  }

  function scheduleSpeechFinalize(reason, delayMs = 2000) {
    clearSpeechFinalizeTimer();
    pendingSpeechFinalize = setTimeout(() => {
      pendingSpeechFinalize = null;
      if (speechTranscriptCommitted || !bestAvailableTranscript()) return;
      if (!transcriptLooksStable()) {
        const now = Date.now();
        const waitForStability = Math.max(150, USER_TRANSCRIPT_STABILITY_MS - (now - lastTranscriptUpdateAt));
        const waitForCap = lastVadSpeechEnd ? Math.max(150, USER_TRANSCRIPT_MAX_WAIT_MS - (now - lastVadSpeechEnd)) : USER_TRANSCRIPT_STABILITY_MS;
        scheduleSpeechFinalize(reason, Math.min(waitForStability, waitForCap));
        return;
      }
      finalizeUserTurn(reason);
    }, delayMs);
  }

  function finalizeUserTurn(reason, requestResponse = true) {
    const committed = commitUserTranscript(reason);
    if (committed && requestResponse) {
      handleCommittedUserText(committed, reason);
    }
    return committed;
  }

  function tryAcceptFreshAsrText(text, label) {
    if (speechTranscriptCommitted) return false;
    if (!inputTranscriptBuffer && !volcAsrAccumulator && shouldIgnoreStaleAsrText(text)) return false;
    clearStaleAsrGuard();
    return true;
  }

  function emitInterimUserTranscript(text, allowWhenVolcSilent = false) {
    if (allowWhenVolcSilent && volcAsrAccumulator.trim()) return;
    send({ type: "asr", data: { results: [{ text }] } });
  }

  function handleVolcInterimText(text, label) {
    if (!tryAcceptFreshAsrText(text, label)) return;
    volcAsrAccumulator = mergeAsrText(volcAsrAccumulator, text);
    noteTranscriptUpdate();
    emitInterimUserTranscript(volcAsrAccumulator);
  }

  function handleVolcFinalText(reason, logLabel) {
    const userText = bestAvailableTranscript();
    if (userText && !volcAsrPreFlushed) {
      if (USE_VOLC_ASR_PRIMARY) {
        finalizeUserTurn(reason);
      } else {
        noteTranscriptUpdate();
        emitInterimUserTranscript(userText);
      }
    }
    volcAsrPreFlushed = false;
  }

  function handleWhisperDelta(delta) {
    if (!delta || !tryAcceptFreshAsrText(delta, "Whisper delta")) return;
    inputTranscriptBuffer += delta;
    noteTranscriptUpdate();
    if (pendingAsrUpdate) clearTimeout(pendingAsrUpdate);
    pendingAsrUpdate = setTimeout(() => {
      pendingAsrUpdate = null;
      emitInterimUserTranscript(inputTranscriptBuffer, true);
    }, 150);
    if (pendingInputFlush) scheduleInputFlush();
  }

  function handleWhisperCompletedTranscript(transcript) {
    if (!transcript || !tryAcceptFreshAsrText(transcript, "Whisper completion")) return;
    const msSinceVadSpeech = Date.now() - lastVadSpeechEnd;
    if (isWhisperHallucination(transcript) || (msSinceVadSpeech > 10_000 && transcript.trim().split(/\s+/).length <= 6)) return;
    inputTranscriptBuffer = mergeAsrText(inputTranscriptBuffer, transcript);
    noteTranscriptUpdate();
    if (pendingAsrUpdate) clearTimeout(pendingAsrUpdate);
    pendingAsrUpdate = null;
    emitInterimUserTranscript(inputTranscriptBuffer, true);
    scheduleInputFlush();
  }

  function handleSpeechStartedEvent() {
    speechStopForwardGraceUntil = 0;
    queuedAssistantResponse = null;
    if (shouldSplitUserTurnOnSpeechStart()) {
      finalizeUserTurn("speech restart", false);
    }
    cancelOngoingResponse();
    clearSpeechFinalizeTimer();
    vadSpeechActive = true;
    lastTranscriptUpdateAt = 0;
    if (speechTranscriptCommitted) {
      speechTranscriptCommitted = false;
      volcAsrAccumulator = "";
      inputTranscriptBuffer = "";
    }
    send({ type: "interrupt" });
  }

  function handleSpeechStoppedEvent() {
    vadSpeechActive = false;
    lastVadSpeechEnd = Date.now();
    speechStopForwardGraceUntil = lastVadSpeechEnd + SPEECH_STOP_FORWARD_GRACE_MS;
    if (!speechTranscriptCommitted && bestAvailableTranscript()) {
      scheduleSpeechFinalize("speech stop", USER_SPEECH_STOP_FINALIZE_MS);
    }
  }

  function flushPendingUserTurnBeforeAssistant() {
    if (!speechTranscriptCommitted && bestAvailableTranscript()) {
      if (transcriptLooksStable()) {
        volcAsrPreFlushed = true;
        finalizeUserTurn("response pre-flush");
      } else {
        scheduleSpeechFinalize("response pre-flush", USER_TRANSCRIPT_STABILITY_MS);
      }
      return;
    }
    if (volcAsrAccumulator.trim()) {
      volcAsrAccumulator = "";
      volcAsrPreFlushed = true;
    }
  }

  function buildRealtimeAudioInputConfig() {
    return {
      format: { type: "audio/pcm", rate: 24000 },
      noise_reduction: { type: "far_field" },
      transcription: { model: OPENAI_REALTIME_TRANSCRIPTION_MODEL },
      turn_detection: { type: "semantic_vad", eagerness: "low", create_response: false, interrupt_response: true },
    };
  }

  function setOpenAiTranscriptionEnabled(enabled, reason) {
    if (!enabled) return;
    if (openAiTranscriptionEnabled === enabled) return;
    openAiTranscriptionEnabled = enabled;

    if (!oaiWs || oaiWs.readyState !== WebSocket.OPEN) return;
    const updateSessionConfig = USE_DIRECT_OPENAI ? {
      input_audio_transcription: enabled ? { model: OPENAI_REALTIME_TRANSCRIPTION_MODEL } : null,
    } : {
      type: "realtime",
      audio: {
        input: enabled ? buildRealtimeAudioInputConfig() : {
          format: { type: "audio/pcm", rate: 24000 },
          noise_reduction: { type: "far_field" },
          turn_detection: { type: "semantic_vad", eagerness: "low", create_response: false, interrupt_response: true },
        },
      },
    };

    oaiWs.send(JSON.stringify({ type: "session.update", session: updateSessionConfig }));
  }

  function markInterviewComplete(reason) {
    if (!pendingInterviewComplete) return;
    pendingInterviewComplete = false;
    if (interviewCompleteTimer) { clearTimeout(interviewCompleteTimer); interviewCompleteTimer = null; }
    send({ type: "interview_complete" });
  }

  let volcWs = null;
  let volcAlive = false;
  let volcAsrAccumulator = "";
  let volcAsrPreFlushed = false;
  let volcKeepAliveTimer = null;
  let volcSessionErrorLogged = false;
  let volcAudioSeq = 1;

  async function connectVolcAsr() {
    if (!USE_VOLC_ASR_INTERIMS) return;
    if (volcKeepAliveTimer) { clearInterval(volcKeepAliveTimer); volcKeepAliveTimer = null; }
    try {
      const reqid = randomUUID().replace(/-/g, "");
      volcAudioSeq = 1;
      const asrConfig = { format: "pcm", rate: 16000, bits: 16, channels: 1, codec: "raw", showUtterance: true, resultType: "single", enablePunc: true, endWindowSize: 500, forceToSpeechTime: 1000 };
      const wsHeaders = buildBigModelHeaders(VOLC_ASR_APPID, VOLC_ASR_TOKEN, reqid);
      volcWs = new WebSocket(BIGMODEL_ASR_URL, { headers: wsHeaders });

      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("Volcengine ASR connect timeout")), 10_000);
        volcWs.on("open", () => { clearTimeout(t); resolve(); });
        volcWs.on("error", (e) => { clearTimeout(t); reject(e); });
      });

      volcWs.on("message", (data) => {
        try {
          const resp = parseAsrResponse(Buffer.from(data));
          if (resp.messageType === 0x0b) {
            if (!volcAlive) {
              volcAlive = true;
              if (USE_VOLC_ASR_PRIMARY) setOpenAiTranscriptionEnabled(false, "Volcengine ASR connected");
            }
            return;
          }
          if (resp.errorCode || (resp.code && resp.code !== 1000)) {
            const code = resp.code || resp.errorCode;
            if (!volcAlive) { volcAlive = false; setOpenAiTranscriptionEnabled(true, `Volcengine ASR error ${code}`); volcWs?.close(); }
            return;
          }
          if (!volcAlive) return;

          if (resp.utterances && resp.utterances.length > 0) {
            const utt = resp.utterances[0];
            if (utt.text && !volcAsrPreFlushed) handleVolcInterimText(utt.text, "Volc ASR");
            if (utt.definite) handleVolcFinalText("volc definite", "Volc ASR");
          } else if (resp.text && !volcAsrPreFlushed) {
            handleVolcInterimText(resp.text, "Volc ASR final");
            if (resp.isLastPackage) handleVolcFinalText("volc final", "Volc ASR final");
          }
        } catch (err) { log.error("Volcengine ASR parse error:", err); }
      });

      volcWs.send(buildBigModelFullRequest(asrConfig, reqid));
      volcAlive = true;
      volcWs.on("close", () => { volcAlive = false; setOpenAiTranscriptionEnabled(true, "Volcengine ASR closed"); if (!browserClosed && !interviewDone) reconnectVolcAsr(); });
      volcKeepAliveTimer = setInterval(() => { if (!volcAlive || !volcWs || volcWs.readyState !== WebSocket.OPEN) return; volcAudioSeq++; volcWs.send(buildBigModelAudioRequest(Buffer.alloc(3200), volcAudioSeq)); }, 5_000);
    } catch (err) { volcAlive = false; setOpenAiTranscriptionEnabled(true, "Volcengine ASR connection failed"); }
  }

  function reconnectVolcAsr() { if (browserClosed || interviewDone) return; setTimeout(() => connectVolcAsr(), 2_000); }

  function cleanupVolcAsr() {
    volcAlive = false; setOpenAiTranscriptionEnabled(true, "Volcengine ASR cleanup");
    if (volcKeepAliveTimer) { clearInterval(volcKeepAliveTimer); volcKeepAliveTimer = null; }
    if (volcWs && volcWs.readyState === WebSocket.OPEN) { try { volcAudioSeq++; volcWs.send(buildBigModelAudioRequest(Buffer.alloc(0), volcAudioSeq, true)); } catch { } }
    volcWs?.close(); volcWs = null;
  }

  function sendAudioToVolc(pcm16kBuf) { if (!volcAlive || !volcWs || volcWs.readyState !== WebSocket.OPEN) return; volcAudioSeq++; volcWs.send(buildBigModelAudioRequest(pcm16kBuf, volcAudioSeq)); }

  connectVolcAsr();

  let lastAudioSentToOai = Date.now();
  const SILENCE_100MS_24K = Buffer.alloc(4800).toString("base64");
  const keepaliveTimer = setInterval(() => { if (!oaiWs || oaiWs.readyState !== WebSocket.OPEN) return; if ((Date.now() - lastAudioSentToOai) > 4_000) oaiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: SILENCE_100MS_24K })); }, 5_000);

  const livenessTimer = setInterval(() => { if (browserClosed || interviewDone || reconnecting || !oaiWs || oaiWs.readyState !== WebSocket.OPEN) return; const now = Date.now(); if ((now - lastUserInput) < 60_000 && (now - lastOaiActivity) > 120_000) oaiWs.close(); }, 15_000);

  function attachOaiHandlers(ws) {
    ws.on("message", (data) => {
      if (ws !== oaiWs) return;
      lastOaiActivity = Date.now();
      try {
        const msg = JSON.parse(data.toString());
        switch (msg.type) {
          case "error": { if (!/Cancellation failed/i.test(msg.error?.message)) log.error("OpenAI error:", msg.error?.message); responseInFlight = false; break; }
          case "response.created": responseInFlight = true; break;
          case "conversation.item.input_audio_transcription.delta": if (openAiTranscriptionEnabled && !speechTranscriptCommitted) handleWhisperDelta(msg.delta || ""); break;
          case "conversation.item.input_audio_transcription.completed": if (openAiTranscriptionEnabled && !speechTranscriptCommitted) handleWhisperCompletedTranscript(msg.transcript || ""); break;
          case "response.output_audio.delta": { clearQuestionPrompt(); modelIsSpeaking = true; if (!isTransitioning && msg.delta) { if (!responseAudioStarted) { responseAudioStarted = true; responseAudioStartedAt = Date.now(); for (const t of pendingTtsText) send({ type: "tts_text", data: { text: t } }); pendingTtsText = []; } lastTtsAudioTime = Date.now(); const int16Buf = Buffer.from(msg.delta, "base64"); const float32Buf = int16ToFloat32(int16Buf); responseTtsBytes += float32Buf.length; sendBinary(float32Buf); } break; }
          case "response.output_audio_transcript.delta": if (msg.delta) { outputTranscriptBuffer += msg.delta; if (responseAudioStarted) send({ type: "tts_text", data: { text: msg.delta } }); else pendingTtsText.push(msg.delta); } break;
          case "response.function_call_arguments.done": {
            if (msg.name === "signal_question_change") {
              let args = {}; try { args = JSON.parse(msg.arguments || "{}"); } catch { }
              const newIdx = args.questionIndex ?? (currentQuestionIndex + 1);
              const userRequested = args.userRequested === true;
              if (newIdx >= 0 && newIdx < sortedQuestions.length && newIdx === currentQuestionIndex) {
                pendingFunctionCalls.push({ callId: msg.call_id, name: msg.name, args: `Already on question ${newIdx + 1}.` });
                break;
              }
              const dwellMs = Date.now() - questionEnteredAt;
              const isForward = newIdx > currentQuestionIndex && newIdx < sortedQuestions.length;
              const needsWordGuard = isForward && !userRequested;
              if (newIdx < sortedQuestions.length && (lastUserInput === 0 || dwellMs < MIN_QUESTION_DWELL_MS || (needsWordGuard && userCommittedWordsThisQuestion < MIN_WORDS_BEFORE_TRANSITION))) {
                pendingFunctionCalls.push({ callId: msg.call_id, name: msg.name, args: `Rejected premature transition.` });
                break;
              }
              clearPendingTransition();
              let result = newIdx >= sortedQuestions.length ? "Interview complete." : `Moved to question ${newIdx + 1}.`;
              if (newIdx >= sortedQuestions.length) { if (!interviewDone) { interviewDone = true; pendingInterviewComplete = true; interviewCompleteTimer = setTimeout(() => { if (pendingInterviewComplete) markInterviewComplete("timeout fallback"); }, 15_000); } }
              else if (newIdx >= 0 && newIdx !== currentQuestionIndex) { send({ type: "transitioning", auto: true, direction: newIdx > currentQuestionIndex ? "next" : "previous" }); currentQuestionIndex = newIdx; questionEnteredAt = Date.now(); userCommittedWordsThisQuestion = 0; disableTools(); send({ type: "question_change", questionIndex: currentQuestionIndex, totalQuestions: sortedQuestions.length, auto: true }); pushHistory("user", `[Moved to question ${currentQuestionIndex + 1}]`); }
              pendingFunctionCalls.push({ callId: msg.call_id, name: msg.name, args: result });
            }
            break;
          }
          case "input_audio_buffer.speech_started": handleSpeechStartedEvent(); break;
          case "input_audio_buffer.speech_stopped": handleSpeechStoppedEvent(); break;
          case "response.done": {
            responseInFlight = false; const queuedResponse = takeQueuedAssistantResponse();
            if (pendingAsrUpdate) { clearTimeout(pendingAsrUpdate); pendingAsrUpdate = null; if (inputTranscriptBuffer) send({ type: "asr", data: { results: [{ text: inputTranscriptBuffer }] } }); }
            const hadTts = !!(outputTranscriptBuffer || modelIsSpeaking);
            const capturedModelText = outputTranscriptBuffer;
            const completedFarewellTurn = pendingInterviewComplete && hadTts && responseTtsBytes > 0;
            outputTranscriptBuffer = ""; modelIsSpeaking = false;
            if (!pendingInterviewComplete && currentQuestionIndex >= sortedQuestions.length - 1 && !!capturedModelText && looksLikeFarewell(capturedModelText, isZh)) { interviewDone = true; pendingInterviewComplete = true; }
            if (hadTts && responseTtsBytes > 0) { flushPendingUserTurnBeforeAssistant(); if (inputTranscriptBuffer) flushUserInput(); if (capturedModelText) pushHistory("assistant", capturedModelText); send({ type: "tts_ended" }); }
            if (!hadTts && pendingFunctionCalls.length === 0 && (msg.response?.output?.length ?? 0) === 0 && !interviewDone && !queuedResponse) {
              emptyResponseRetries++; if (emptyResponseRetries <= MAX_EMPTY_RETRIES) requestAssistantResponse(`empty response retry ${emptyResponseRetries}`);
            } else if (hadTts) emptyResponseRetries = 0;
            if (pendingFunctionCalls.length > 0) {
              if (queuedResponse) queuedAssistantResponse = queuedResponse;
              const calls = [...pendingFunctionCalls]; pendingFunctionCalls = [];
              for (const fc of calls) ws.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: fc.callId, output: fc.args } }));
              requestAssistantResponse("function call follow-up");
            } else if (queuedResponse) requestAssistantResponse(`queued`, queuedResponse.response);
            if (completedFarewellTurn) markInterviewComplete("after farewell");
            if (inputTranscriptBuffer) scheduleInputFlush();
            break;
          }
        }
      } catch (err) { log.error("Error parsing OpenAI message:", err); }
    });

    ws.on("close", () => {
      if (ws !== oaiWs) return;
      oaiWs = null;
      if (browserClosed || interviewDone) return;
      if (pendingInputFlush) { clearTimeout(pendingInputFlush); pendingInputFlush = null; }
      if (pendingAsrUpdate) { clearTimeout(pendingAsrUpdate); pendingAsrUpdate = null; }
      if (inputTranscriptBuffer) pushHistory("user", inputTranscriptBuffer);
      if (outputTranscriptBuffer) { pushHistory("assistant", outputTranscriptBuffer); outputTranscriptBuffer = ""; }
      modelIsSpeaking = false; pendingFunctionCalls = [];
      send({ type: "session_reconnecting" });
      reconnectOai().catch(() => { if (browserWs.readyState === WebSocket.OPEN) { send({ type: "disconnected" }); browserWs.close(); } });
    });
  }

  async function connectOai() {
    const ws = new WebSocket(OPENAI_WS_URL, { headers: OPENAI_WS_HEADERS });
    await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("OpenAI connect timeout")), 10_000); ws.on("open", () => { clearTimeout(t); resolve(); }); ws.on("error", (e) => { clearTimeout(t); reject(e); }); });
    await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("Session create timeout")), 10_000); const h = (data) => { try { const msg = JSON.parse(data.toString()); if (msg.type === "session.created") { clearTimeout(t); ws.removeListener("message", h); resolve(); } } catch { } }; ws.on("message", h); });
    const systemPrompt = buildSystemPrompt(ctx, currentQuestionIndex);
    const mainSessionConfig = USE_DIRECT_OPENAI ? { modalities: ["audio", "text"], instructions: systemPrompt, voice: AZURE_VOICE, input_audio_format: "pcm16", output_audio_format: "pcm16", input_audio_transcription: { model: OPENAI_REALTIME_TRANSCRIPTION_MODEL }, turn_detection: { type: "server_vad", create_response: false }, tools: OPENAI_TOOLS, tool_choice: "auto" } : { type: "realtime", instructions: systemPrompt, output_modalities: ["audio"], audio: { input: buildRealtimeAudioInputConfig(), output: { format: { type: "audio/pcm", rate: 24000 }, voice: AZURE_VOICE } }, tools: OPENAI_TOOLS, tool_choice: "auto" };
    ws.send(JSON.stringify({ type: "session.update", session: mainSessionConfig }));
    await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("Session update timeout")), 10_000); const h = (data) => { try { const msg = JSON.parse(data.toString()); if (msg.type === "session.updated") { clearTimeout(t); ws.removeListener("message", h); resolve(); } } catch { } }; ws.on("message", h); });
    return ws;
  }

  async function reconnectOai() {
    if (reconnecting) return;
    reconnecting = true;
    await new Promise((r) => setTimeout(r, 500));
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const ws = await connectOai(); oaiWs = ws; oaiSessionStart = Date.now(); lastOaiActivity = Date.now(); lastAudioSentToOai = Date.now(); attachOaiHandlers(ws);
        let codeContext = latestCode ? `\n\nCode:\n\`\`\`${latestCodeLanguage}\n${latestCode}\n\`\`\`` : "";
        const resumePrompt = `[SYSTEM] Reconnected. On question ${currentQuestionIndex + 1}.${codeContext}`;
        if (conversationHistory.length > 0) { for (const h of conversationHistory.slice(-12)) ws.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: h.role, content: [{ type: "input_text", text: h.text }] } })); }
        ws.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: resumePrompt }] } }));
        reconnecting = false; send({ type: "session_reconnected" });
        if (pendingQuestionPrompt) { const p = pendingQuestionPrompt; pendingQuestionPrompt = null; sendQuestionPrompt(p); }
        return;
      } catch (err) { if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt)); }
    }
    reconnecting = false; throw new Error("Reconnect failed");
  }

  try {
    oaiWs = await connectOai(); oaiSessionStart = Date.now(); attachOaiHandlers(oaiWs);
    send({ type: "ready", sessionId: "openai-session" });
    send({ type: "question_change", questionIndex: currentQuestionIndex, totalQuestions: sortedQuestions.length });
    await new Promise((r) => setTimeout(r, 1500));
    const greeting = currentQuestionIndex > 0 ? `Returning to Q${currentQuestionIndex + 1}.` : "Greet and start with Q1.";
    oaiWs.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: `[SYSTEM] ${greeting}` }] } }));
    requestAssistantResponse("initial greeting", { tool_choice: "none" });
  } catch (err) { browserWs.close(); return; }

  function requestTransition(targetIdx, directionLabel, reason = "button") {
    clearPendingTransition(); clearQuestionPrompt(); cancelOngoingResponse();
    isTransitioning = true; send({ type: "transitioning", direction: targetIdx > currentQuestionIndex ? "next" : "previous" });
    setTimeout(() => {
      if (targetIdx === currentQuestionIndex) { isTransitioning = false; return; }
      if (targetIdx >= sortedQuestions.length) { isTransitioning = false; if (!interviewDone) { interviewDone = true; pendingInterviewComplete = true; interviewCompleteTimer = setTimeout(() => { if (pendingInterviewComplete) markInterviewComplete("timeout"); }, 15_000); } return; }
      currentQuestionIndex = targetIdx; questionEnteredAt = Date.now(); userCommittedWordsThisQuestion = 0; disableTools();
      pushHistory("user", `[Moved to Q${currentQuestionIndex + 1}]`);
      send({ type: "question_change", questionIndex: currentQuestionIndex, totalQuestions: sortedQuestions.length });
      isTransitioning = false;
      sendQuestionPrompt(`[SYSTEM] We are now on Q${currentQuestionIndex + 1}.`);
    }, 500);
  }

  function tryHandleExplicitUserNavigation(text) {
    const userText = text.trim(); if (!userText || isTransitioning || interviewDone) return false;
    if (isFastPrevRequest(userText) || isUserPrevRequest(userText)) { if (currentQuestionIndex <= 0) return false; requestTransition(currentQuestionIndex - 1, "Previous", "user_request"); return true; }
    if (isFastNextRequest(userText) || isUserSkipRequest(userText)) { const nextIdx = Math.min(currentQuestionIndex + 1, sortedQuestions.length); if (nextIdx === currentQuestionIndex) return false; requestTransition(nextIdx, "Next", "user_request"); return true; }
    return false;
  }

  browserWs.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "next_question") { const nextIdx = Math.min(currentQuestionIndex + 1, sortedQuestions.length); if (nextIdx !== currentQuestionIndex) requestTransition(nextIdx, "Next"); return; }
      if (msg.type === "prev_question") { const prevIdx = Math.max(currentQuestionIndex - 1, 0); if (prevIdx !== currentQuestionIndex) requestTransition(prevIdx, "Previous"); return; }
      if (msg.type === "ping") { send({ type: "pong" }); return; }
      if (reconnecting || !oaiWs || oaiWs.readyState !== WebSocket.OPEN) return;
      if (msg.type === "audio" && msg.data) {
        if (isTransitioning) return;
        const pcm16k = Buffer.from(msg.data, "hex"); const nowMs = Date.now();
        const samples = new Int16Array(pcm16k.buffer, pcm16k.byteOffset, pcm16k.length / 2);
        let sumSq = 0; for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
        const rms = Math.sqrt(sumSq / (samples.length || 1));
        if (!vadSpeechActive && rms < MIN_AUDIO_RMS) { if (nowMs >= speechStopForwardGraceUntil || rms < CONTINUATION_AUDIO_RMS) return; }
        lastUserInput = nowMs;
        const inEchoCooldown = (nowMs - lastTtsAudioTime) < TTS_ECHO_COOLDOWN_MS;
        if (inEchoCooldown && modelIsSpeaking && responseAudioStarted && responseAudioStartedAt > 0 && nowMs - responseAudioStartedAt >= DEFAULT_TTS_BARGE_IN_MIN_AUDIO_MS && responseTtsBytes >= DEFAULT_TTS_BARGE_IN_MIN_AUDIO_BYTES && rms >= TTS_BARGE_IN_RMS) ttsBargeInFrames++; else ttsBargeInFrames = 0;
        if (shouldAllowTtsBargeIn({ inEchoCooldown, modelIsSpeaking, responseAudioStarted, ttsAudioStartedAt: responseAudioStartedAt, nowMs, responseTtsBytes, rms, thresholdRms: TTS_BARGE_IN_RMS, consecutiveFrames: ttsBargeInFrames, thresholdFrames: TTS_BARGE_IN_FRAME_COUNT })) { ttsBargeInFrames = 0; cancelOngoingResponse(); send({ type: "interrupt" }); }
        if (!inEchoCooldown || modelIsSpeaking) { lastAudioSentToOai = Date.now(); oaiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: resample16to24(pcm16k).toString("base64") })); }
        if (rms >= MIN_AUDIO_RMS) sendAudioToVolc(pcm16k);
      } else if (msg.type === "text_input" && msg.content) {
        const text = msg.content.trim();
        if (text) { lastUserInput = Date.now(); queuedAssistantResponse = null; pushHistory("user", text); if (tryHandleExplicitUserNavigation(text)) return; send({ type: "interrupt" }); cancelOngoingResponse(); oaiWs.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } })); requestAssistantResponse("text input"); }
      } else if (msg.type === "code_update") {
        const content = msg.content || ""; const language = msg.language || "plaintext"; latestCode = content; latestCodeLanguage = language;
        if (content) { oaiWs.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: `[CODE_UPDATE] ${language}:\n${content}` }] } })); oaiWs.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "assistant", content: [{ type: "text", text: "(Noted)" }] } })); }
      } else if (msg.type === "text" && msg.content) {
        oaiWs.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: `[SYSTEM] Say: ${msg.content}` }] } })); requestAssistantResponse("system say-aloud");
      } else if (msg.type === "whiteboard_update") {
        const img = msg.imageDataUrl || "";
        if (img) { oaiWs.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_image", image_url: img }] } })); oaiWs.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "assistant", content: [{ type: "text", text: "(Received)" }] } })); }
      }
    } catch (err) { }
  });

  browserWs.on("close", () => {
    browserClosed = true; clearInterval(keepaliveTimer); clearInterval(livenessTimer);
    clearPendingTransition(); clearQuestionPrompt(); cleanupVolcAsr();
    if (pendingInputFlush) clearTimeout(pendingInputFlush); if (pendingAsrUpdate) clearTimeout(pendingAsrUpdate); if (interviewCompleteTimer) clearTimeout(interviewCompleteTimer);
    oaiWs?.close();
  });
}
