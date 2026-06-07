"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Code2,
  Loader2,
  Maximize,
  Mic,
  MicOff,
  PhoneOff,
  Send,
  ShieldAlert,
  ShieldCheck,
  Volume2,
  XCircle,
} from "lucide-react";

// ─── Questions ────────────────────────────────────────────────────────────────

const QUESTIONS = [
  {
    id: "q1", type: "THEORY", title: "Lists vs Tuples",
    text: "Explain the main differences between a List and a Tuple in Python. When would you choose to use one over the other? Also explain mutability and how it relates to memory.",
  },
  {
    id: "q2", type: "CODING", title: "Two Sum",
    text: "Write a function that takes an array of integers and a target, and returns the indices of the two numbers that add up to the target. Aim for O(n) time complexity.",
    starterCode: "def two_sum(nums, target):\n    # Your solution here\n    pass\n\n# Example: two_sum([2, 7, 11, 15], 9) => [0, 1]",
  },
  {
    id: "q3", type: "THEORY", title: "Python GIL",
    text: "What is the Global Interpreter Lock (GIL) in Python? How does it affect multi-threading and multi-processing? When would you choose multiprocessing over multithreading?",
  },
  {
    id: "q4", type: "CODING", title: "Valid Palindrome",
    text: "Write a function is_palindrome(s) that checks whether a given string is a valid palindrome, considering only alphanumeric characters and ignoring cases.",
    starterCode: "def is_palindrome(s: str) -> bool:\n    # Your solution here\n    pass\n\n# is_palindrome('A man, a plan, a canal: Panama') => True",
  },
  {
    id: "q5", type: "CODING", title: "Fibonacci Generator",
    text: "Implement a Python generator function fib_gen() that yields Fibonacci numbers indefinitely. Then write first_n_fibs(n) that returns the first n Fibonacci numbers as a list.",
    starterCode: "def fib_gen():\n    # Infinite generator\n    pass\n\ndef first_n_fibs(n: int) -> list:\n    pass\n\n# first_n_fibs(8) => [0, 1, 1, 2, 3, 5, 8, 13]",
  },
];

function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// ─── useTestVoice Hook ────────────────────────────────────────────────────────
// Same pipeline as useVoice, but calls /api/ai/test-chat (no DB needed).

function useTestVoice({ onTranscript, onAIResponse, onComplete }) {
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentQ, setCurrentQ] = useState(0);
  const [userTranscript, setUserTranscript] = useState("");
  const [aiTranscript, setAiTranscript] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);
  const [messages, setMessages] = useState([]);

  const mediaStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const messagesRef = useRef([]);
  const currentQRef = useRef(0);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { currentQRef.current = currentQ; }, [currentQ]);

  // Mic audio level animation
  const startLevelMeter = useCallback((stream) => {
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyserRef.current = analyser;
    analyser.fftSize = 256;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setAudioLevel(Math.min(1, avg / 80));
      animFrameRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const stopLevelMeter = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    setAudioLevel(0);
  }, []);

  const connect = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      setIsConnected(true);
    } catch {
      alert("Microphone access denied. Voice mode requires microphone access.");
    }
  }, []);

  const interruptPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  const playTTS = useCallback(async (text) => {
    setIsSpeaking(true);
    try {
      const voiceApiUrl = process.env.NEXT_PUBLIC_VOICE_API_URL || "http://localhost:8000";
      const res = await fetch(`${voiceApiUrl}/api/tts/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error("TTS failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => setIsSpeaking(false);
      await audio.play();
    } catch {
      setIsSpeaking(false);
    }
  }, []);

  const getAIResponse = useCallback(async (userText, qIndex) => {
    setIsProcessing(true);
    setUserTranscript(userText);
    try {
      const history = [...messagesRef.current, { role: "USER", content: userText }];
      const res = await fetch("/api/ai/test-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          currentQuestionIndex: qIndex ?? currentQRef.current,
          questions: QUESTIONS.map((q) => ({ type: q.type, text: q.text, starterCode: q.starterCode })),
        }),
      });
      if (!res.ok) throw new Error("AI failed");
      const data = await res.json();

      const userMsg = { id: crypto.randomUUID(), role: "USER", content: userText };
      const aiMsg = { id: crypto.randomUUID(), role: "ASSISTANT", content: data.content };
      setMessages((prev) => [...prev, userMsg, aiMsg]);
      setAiTranscript(data.content);
      onAIResponse?.(data.content);

      if (data.questionAdvanced && currentQRef.current < QUESTIONS.length - 1) {
        setCurrentQ((prev) => prev + 1);
      }
      if (data.isComplete) {
        onComplete?.();
      }

      // Speak the AI response via TTS
      await playTTS(data.content);
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
      setUserTranscript("");
    }
  }, [onAIResponse, onComplete, playTTS]);

  const startListening = useCallback(() => {
    if (!mediaStreamRef.current) return;
    interruptPlayback();
    startLevelMeter(mediaStreamRef.current);
    const recorder = new MediaRecorder(mediaStreamRef.current);
    mediaRecorderRef.current = recorder;
    audioChunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      stopLevelMeter();
      const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      if (blob.size < 1000) return; // too short / silence
      setIsProcessing(true);
      try {
        const voiceApiUrl = process.env.NEXT_PUBLIC_VOICE_API_URL || "http://localhost:8000";
        const formData = new FormData();
        formData.append("audio", blob, "audio.webm");
        const sttRes = await fetch(`${voiceApiUrl}/api/speech/transcribe`, { method: "POST", body: formData });
        if (!sttRes.ok) throw new Error("STT failed");
        const sttData = await sttRes.json();
        if (sttData.success && sttData.text) {
          onTranscript?.(sttData.text);
          await getAIResponse(sttData.text);
        }
      } catch (err) {
        console.error("[STT]", err);
      } finally {
        setIsProcessing(false);
      }
    };

    recorder.start();
    setIsListening(true);
    setUserTranscript("");
  }, [interruptPlayback, startLevelMeter, stopLevelMeter, getAIResponse, onTranscript]);

  const stopListening = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    stopLevelMeter();
    setIsListening(false);
  }, [stopLevelMeter]);

  const sendText = useCallback(async (text) => {
    if (!text.trim()) return;
    await getAIResponse(text.trim());
  }, [getAIResponse]);

  // Initial AI greeting
  const greetingDone = useRef(false);
  const greet = useCallback(async () => {
    if (greetingDone.current) return;
    greetingDone.current = true;
    setIsProcessing(true);
    try {
      const res = await fetch("/api/ai/test-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [],
          currentQuestionIndex: 0,
          questions: QUESTIONS.map((q) => ({ type: q.type, text: q.text })),
        }),
      });
      const data = await res.json();
      const aiMsg = { id: crypto.randomUUID(), role: "ASSISTANT", content: data.content };
      setMessages([aiMsg]);
      setAiTranscript(data.content);
      await playTTS(data.content);
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  }, [playTTS]);

  const disconnect = useCallback(() => {
    interruptPlayback();
    stopListening();
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    setIsConnected(false);
  }, [interruptPlayback, stopListening]);

  return {
    isConnected, isListening, isSpeaking, isProcessing,
    currentQ, audioLevel, messages, userTranscript, aiTranscript,
    connect, disconnect, startListening, stopListening, sendText, greet, interruptPlayback,
  };
}

// ─── Instructions Screen ──────────────────────────────────────────────────────

function InstructionsScreen({ onStart }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600 mb-4">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">Python Technical Assessment</h1>
          <p className="text-slate-400 mt-2 text-sm">Voice-powered • Proctored • Isolated Test Environment</p>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { icon: <Volume2 className="w-5 h-5" />, label: "Mode", value: "Voice + Text" },
            { icon: <Code2 className="w-5 h-5" />, label: "Questions", value: "5 Python Qs" },
            { icon: <ShieldAlert className="w-5 h-5" />, label: "Proctored", value: "Fullscreen" },
          ].map((item) => (
            <div key={item.label} className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 text-center">
              <div className="flex justify-center text-indigo-400 mb-2">{item.icon}</div>
              <div className="text-xs text-slate-500 uppercase tracking-wide">{item.label}</div>
              <div className="text-sm font-semibold text-white mt-1">{item.value}</div>
            </div>
          ))}
        </div>

        <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-6 mb-5">
          <h2 className="text-white font-semibold mb-4 flex items-center gap-2 text-sm">
            <AlertTriangle className="w-4 h-4 text-amber-400" /> Interview Rules
          </h2>
          <ul className="space-y-2.5">
            {[
              { c: "text-red-400", t: "Fullscreen is mandatory. Exiting gives you 5 seconds to return or the test ends." },
              { c: "text-amber-400", t: "Copy, Cut, and Paste are completely disabled during the interview." },
              { c: "text-indigo-400", t: "The AI interviewer will speak each question aloud via voice (TTS)." },
              { c: "text-indigo-400", t: "Press and hold the Mic button to record your answer, then release to submit." },
              { c: "text-green-400", t: "You may also type answers in the chat panel below." },
              { c: "text-green-400", t: "A code editor auto-opens for coding questions. Write Python code there." },
            ].map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <ChevronRight className={`w-4 h-4 mt-0.5 shrink-0 ${r.c}`} />
                <span className="text-slate-300">{r.t}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4 mb-5">
          <h3 className="text-slate-400 text-xs uppercase tracking-wide mb-3">Question Overview</h3>
          <div className="space-y-1.5">
            {QUESTIONS.map((q, i) => (
              <div key={q.id} className="flex items-center gap-3">
                <span className="text-xs text-slate-600 w-4">{i + 1}.</span>
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${q.type === "CODING" ? "bg-indigo-900/60 text-indigo-300" : "bg-emerald-900/60 text-emerald-300"}`}>{q.type}</span>
                <span className="text-sm text-slate-300">{q.title}</span>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={onStart}
          className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/40 hover:scale-[1.01] active:scale-[0.99]"
        >
          <Maximize className="w-5 h-5" /> Enter Fullscreen & Start Interview
        </button>
        <p className="text-center text-xs text-slate-600 mt-3">Requires microphone + fullscreen access</p>
      </div>
    </div>
  );
}

// ─── Fullscreen Warning ───────────────────────────────────────────────────────

function FullscreenWarning({ timeLeft, onReturn }) {
  return (
    <div className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center">
      <div className="bg-slate-900 border border-red-500/50 rounded-2xl p-8 text-center max-w-sm w-full mx-4 shadow-2xl">
        <AlertTriangle className="mx-auto w-12 h-12 text-red-400 animate-pulse mb-4" />
        <h2 className="text-2xl font-bold text-red-400">Return to Fullscreen!</h2>
        <p className="text-slate-400 text-sm mt-2 mb-6">Interview will terminate if you don&apos;t return in time.</p>
        <div className="text-8xl font-black mb-6" style={{ color: timeLeft <= 2 ? "#ef4444" : timeLeft <= 3 ? "#f97316" : "#facc15" }}>{timeLeft}</div>
        <button onClick={onReturn} className="w-full py-3 bg-red-600 hover:bg-red-500 text-white font-semibold rounded-xl flex items-center justify-center gap-2">
          <Maximize className="w-4 h-4" /> Return to Fullscreen
        </button>
      </div>
    </div>
  );
}

// ─── Mic Button ───────────────────────────────────────────────────────────────

function MicButton({ isListening, isSpeaking, isProcessing, audioLevel, onPress, onRelease }) {
  const rings = isListening
    ? [1, 0.6, 0.35]
    : isSpeaking
    ? [0.8, 0.5, 0.3]
    : [];

  return (
    <div className="relative flex items-center justify-center select-none">
      {rings.map((opacity, i) => (
        <span
          key={i}
          className="absolute rounded-full animate-ping"
          style={{
            width: `${100 + i * 40 + audioLevel * 20}px`,
            height: `${100 + i * 40 + audioLevel * 20}px`,
            backgroundColor: isListening ? `rgba(99,102,241,${opacity * 0.3})` : `rgba(168,85,247,${opacity * 0.25})`,
          }}
        />
      ))}
      <button
        onPointerDown={onPress}
        onPointerUp={onRelease}
        onPointerLeave={onRelease}
        disabled={isProcessing}
        className={`relative z-10 w-24 h-24 rounded-full flex items-center justify-center shadow-2xl transition-all duration-150 select-none touch-none
          ${isListening
            ? "bg-indigo-600 scale-110 shadow-indigo-500/50"
            : isSpeaking
            ? "bg-violet-700 shadow-violet-500/50 cursor-not-allowed"
            : isProcessing
            ? "bg-slate-700 cursor-not-allowed"
            : "bg-slate-800 border border-slate-600 hover:border-indigo-500 hover:bg-slate-700 active:scale-95"
          }`}
      >
        {isProcessing ? (
          <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
        ) : isListening ? (
          <Mic className="w-8 h-8 text-white" />
        ) : isSpeaking ? (
          <Volume2 className="w-8 h-8 text-violet-300 animate-pulse" />
        ) : (
          <Mic className="w-8 h-8 text-slate-400" />
        )}
      </button>
    </div>
  );
}

// ─── Main Interview UI ────────────────────────────────────────────────────────

function InterviewUI({ onComplete }) {
  const [elapsed, setElapsed] = useState(0);
  const [textInput, setTextInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [isCompleted, setIsCompleted] = useState(false);
  const scrollRef = useRef(null);

  const voice = useTestVoice({
    onTranscript: () => {},
    onAIResponse: () => {},
    onComplete: () => setIsCompleted(true),
  });

  const q = QUESTIONS[voice.currentQ];

  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [voice.messages, voice.isProcessing]);

  // Connect mic + greet on mount
  useEffect(() => {
    voice.connect().then(() => voice.greet());
  }, []); // eslint-disable-line

  // Set starter code when question changes
  useEffect(() => {
    setCodeInput(q?.starterCode || "");
  }, [voice.currentQ, q?.starterCode]);

  const handleSendText = () => {
    const text = textInput.trim();
    const code = codeInput.trim();
    if (!text && !code) return;
    let content = text;
    if (q?.type === "CODING" && code) {
      content = text ? `${text}\n\n\`\`\`python\n${code}\n\`\`\`` : `Here is my code:\n\`\`\`python\n${code}\n\`\`\``;
    }
    voice.sendText(content);
    setTextInput("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendText(); }
  };

  if (isCompleted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-indigo-950 flex items-center justify-center">
        <div className="text-center">
          <CheckCircle2 className="w-20 h-20 text-indigo-400 mx-auto mb-4" />
          <h2 className="text-3xl font-bold text-white mb-2">Interview Complete!</h2>
          <p className="text-slate-400 mb-8">You have completed all {QUESTIONS.length} questions.</p>
          <button onClick={() => window.location.reload()} className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium">Restart</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* LEFT: Question + Mic (mirrors VoiceInterface left panel) */}
      <div className="flex flex-col flex-1 min-w-0 bg-background">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold">Python Assessment</div>
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatTime(elapsed)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${voice.isConnected ? "bg-green-900/40 text-green-400" : "bg-slate-800 text-slate-500"}`}>
              {voice.isConnected ? "● Connected" : "Connecting..."}
            </span>
            <button
              onClick={() => { voice.disconnect(); onComplete(); }}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive transition-colors"
            >
              <PhoneOff className="w-3.5 h-3.5" /> End
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="px-5 pt-3 pb-0 shrink-0">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
            <span>Question {Math.min(voice.currentQ + 1, QUESTIONS.length)} of {QUESTIONS.length}</span>
            <span>{Math.round((voice.currentQ / QUESTIONS.length) * 100)}%</span>
          </div>
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-700"
              style={{ width: `${(voice.currentQ / QUESTIONS.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Current question card */}
        <div className="mx-5 mt-4 rounded-xl border border-border bg-card p-4 shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${q?.type === "CODING" ? "bg-indigo-900/50 text-indigo-300" : "bg-emerald-900/50 text-emerald-300"}`}>
              {q?.type}
            </span>
            <span className="text-sm font-semibold">{q?.title}</span>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">{q?.text}</p>
        </div>

        {/* AI/User transcripts */}
        <div className="mx-5 mt-3 flex-1 min-h-0 flex flex-col gap-2">
          {voice.aiTranscript && (
            <div className="rounded-xl border border-border bg-card/50 px-4 py-3">
              <p className="text-xs text-muted-foreground mb-1">AI Interviewer</p>
              <p className="text-sm leading-relaxed">{voice.aiTranscript}</p>
            </div>
          )}
          {voice.userTranscript && (
            <div className="rounded-xl bg-indigo-600/10 border border-indigo-500/20 px-4 py-3">
              <p className="text-xs text-indigo-400 mb-1">You (transcribing...)</p>
              <p className="text-sm text-indigo-100">{voice.userTranscript}</p>
            </div>
          )}
        </div>

        {/* Mic button area — matches main voice interface centered mic */}
        <div className="flex flex-col items-center justify-center py-8 gap-4 shrink-0">
          <MicButton
            isListening={voice.isListening}
            isSpeaking={voice.isSpeaking}
            isProcessing={voice.isProcessing}
            audioLevel={voice.audioLevel}
            onPress={() => !voice.isSpeaking && voice.startListening()}
            onRelease={() => voice.isListening && voice.stopListening()}
          />
          <p className="text-xs text-muted-foreground">
            {voice.isListening ? "Release to submit answer" :
             voice.isSpeaking ? "AI is speaking..." :
             voice.isProcessing ? "Processing your answer..." :
             "Hold to speak your answer"}
          </p>
          {/* Interrupt button while AI speaks */}
          {voice.isSpeaking && (
            <button
              onClick={voice.interruptPlayback}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              <MicOff className="w-3.5 h-3.5" /> Interrupt
            </button>
          )}
        </div>
      </div>

      {/* RIGHT PANEL: Chat + Code Editor */}
      <div className="w-96 border-l border-border flex flex-col bg-card shrink-0">
        {/* Chat transcript */}
        <div className="border-b border-border px-4 py-3 shrink-0">
          <span className="text-xs font-medium text-muted-foreground">Chat / Transcript</span>
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          {voice.messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === "USER" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${msg.role === "USER" ? "bg-indigo-600 text-white rounded-br-sm" : "bg-muted text-foreground rounded-bl-sm border border-border"}`}>
                {msg.content}
              </div>
            </div>
          ))}
          {voice.isProcessing && (
            <div className="flex justify-start">
              <div className="bg-muted border border-border rounded-2xl rounded-bl-sm px-3 py-2.5 flex gap-1">
                {[0,1,2].map((i) => <div key={i} className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />)}
              </div>
            </div>
          )}
        </div>

        {/* Code editor for CODING questions */}
        {q?.type === "CODING" && (
          <div className="border-t border-border shrink-0">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30">
              <Code2 className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-xs text-muted-foreground font-medium">Python Editor</span>
            </div>
            <textarea
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              rows={8}
              spellCheck={false}
              className="w-full bg-background text-foreground font-mono text-xs p-3 resize-none focus:outline-none border-0 leading-relaxed"
              style={{ fontFamily: "'Fira Code', Consolas, monospace" }}
            />
          </div>
        )}

        {/* Text input */}
        <div className="border-t border-border p-3 shrink-0">
          <div className="flex gap-2">
            <textarea
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your answer or press mic above..."
              rows={2}
              className="flex-1 bg-background border border-border rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:border-indigo-500 transition-colors"
            />
            <button
              onClick={handleSendText}
              disabled={voice.isProcessing || (!textInput.trim() && !(q?.type === "CODING" && codeInput.trim()))}
              className="px-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-xl transition-colors"
            >
              {voice.isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Root Page ────────────────────────────────────────────────────────────────

export default function TestInterviewPage() {
  const [phase, setPhase] = useState("instructions");
  const [warningTime, setWarningTime] = useState(5);
  const warningTimerRef = useRef(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const enterFullscreen = useCallback(async () => {
    try { await document.documentElement.requestFullscreen({ navigationUI: "hide" }); } catch { /* fallback */ }
  }, []);

  const handleStart = useCallback(async () => {
    await enterFullscreen();
    setPhase("interviewing");
  }, [enterFullscreen]);

  const handleReturn = useCallback(async () => {
    clearInterval(warningTimerRef.current);
    await enterFullscreen();
    setPhase("interviewing");
  }, [enterFullscreen]);

  useEffect(() => {
    const onFsChange = () => {
      const cur = phaseRef.current;
      if (cur === "failed" || cur === "completed" || cur === "instructions") return;
      if (!document.fullscreenElement) {
        setPhase("warning");
        setWarningTime(5);
        clearInterval(warningTimerRef.current);
        warningTimerRef.current = setInterval(() => {
          setWarningTime((p) => {
            if (p <= 1) { clearInterval(warningTimerRef.current); setPhase("failed"); return 0; }
            return p - 1;
          });
        }, 1000);
      } else if (phaseRef.current === "warning") {
        clearInterval(warningTimerRef.current);
        setPhase("interviewing");
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => { document.removeEventListener("fullscreenchange", onFsChange); clearInterval(warningTimerRef.current); };
  }, []);

  const block = useCallback((e) => {
    if (phaseRef.current === "interviewing" || phaseRef.current === "warning") e.preventDefault();
  }, []);

  if (phase === "instructions") return <InstructionsScreen onStart={handleStart} />;

  if (phase === "failed") return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="text-center max-w-sm">
        <XCircle className="w-20 h-20 text-red-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-white mb-2">Interview Terminated</h2>
        <p className="text-slate-400 mb-6">You exited fullscreen and did not return in time.</p>
        <button onClick={() => window.location.reload()} className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl">Try Again</button>
      </div>
    </div>
  );

  return (
    <div className="w-full h-screen overflow-hidden" onCopy={block} onCut={block} onPaste={block}>
      {phase === "warning" && <FullscreenWarning timeLeft={warningTime} onReturn={handleReturn} />}
      <InterviewUI onComplete={() => { if (document.fullscreenElement) document.exitFullscreen(); setPhase("completed"); }} />
    </div>
  );
}
