"use client";

import { createLogger } from '../lib/logger.js';
import {
  cancelBrowserSpeech,
  createBrowserRecognizer,
  isBrowserSTTAvailable,
  preloadBrowserVoices,
  speakWithBrowser,
} from '../lib/speech-utils.js';
import { useCallback, useEffect, useRef, useState } from "react";

const log = createLogger("voice");

function pickRecorderMime() {
  if (typeof MediaRecorder === "undefined") return "";
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
    .find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

export function useVoice({
  sessionId,
  interviewId,
  interviewContext,
  onTranscript,
  onAIResponse,
  onError,
  onQuestionChange,
  messages,
  onTtsChunk,
  onInterrupt,
}) {
  const startIndex = interviewContext.startQuestionIndex ?? 0;
  const language = interviewContext.language ?? "en-US";

  const [state, setState] = useState({
    isConnected: false,
    isListening: false,
    isSpeaking: false,
    isProcessing: false,
    isTransitioning: false,
    transitionDirection: null,
    isSaving: false,
    isInterviewComplete: false,
    userTranscript: "",
    aiTranscript: "",
    lastAssistantUtteranceEndedAt: 0,
    audioLevel: 0,
    currentQuestionIndex: startIndex,
    totalQuestions: interviewContext.questions.length,
  });

  const mediaStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioRef = useRef(null);
  const browserRecognizerRef = useRef(null);
  const browserTranscriptRef = useRef("");
  const trackedMessagesRef = useRef([]);
  const messagesRef = useRef(messages || []);
  const currentQuestionIndexRef = useRef(startIndex);
  const greetingDoneRef = useRef(false);
  const recorderMimeRef = useRef("");
  
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const maxVolumeRef = useRef(0);
  const volumeAnimationFrameRef = useRef(null);

  useEffect(() => { messagesRef.current = messages || []; }, [messages]);
  useEffect(() => { currentQuestionIndexRef.current = state.currentQuestionIndex; }, [state.currentQuestionIndex]);
  useEffect(() => { preloadBrowserVoices(); }, []);

  const cleanup = useCallback(() => {
    try { browserRecognizerRef.current?.stop(); } catch { /* noop */ }
    browserRecognizerRef.current = null;
    if (mediaRecorderRef.current?.state === "recording") {
      try { mediaRecorderRef.current.stop(); } catch { /* noop */ }
    }
    cancelBrowserSpeech();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setState((s) => ({
      ...s,
      isConnected: false,
      isListening: false,
      isSpeaking: false,
      isProcessing: false,
    }));
  }, []);

  useEffect(() => () => { cleanup(); }, [cleanup]);

  const silenceTimerRef = useRef(null);

  // Auto-start mic after AI finishes speaking
  useEffect(() => {
    if (!state.isSpeaking && state.lastAssistantUtteranceEndedAt > 0 && !state.isInterviewComplete && !state.isListening && state.isConnected && !previewDisabled()) {
      const t = setTimeout(() => {
        if (!mediaStreamRef.current) return;
        // The startListening function is in the dependency array, so we must be careful.
        // We can just call it if we're not currently processing.
        if (!state.isProcessing) {
          startListening();
        }
      }, 500);
      return () => clearTimeout(t);
    }
  }, [state.isSpeaking, state.lastAssistantUtteranceEndedAt, state.isInterviewComplete, state.isListening, state.isConnected, state.isProcessing]); // removed startListening from deps to avoid cycles

  // 30-second silence timeout
  useEffect(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    if (state.isListening && !state.isProcessing && !state.isSpeaking) {
      silenceTimerRef.current = setTimeout(() => {
        if (state.userTranscript.trim()) {
          stopListening();
        } else {
          stopListening();
          nextQuestion();
        }
      }, 30000);
    }

    return () => {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
    };
  }, [state.isListening, state.userTranscript, state.isProcessing, state.isSpeaking]); // removed stopListening/nextQuestion to avoid cycles

  const interruptPlayback = useCallback(() => {
    cancelBrowserSpeech();
    onInterrupt?.();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setState((s) => ({ ...s, isSpeaking: false }));
  }, [onInterrupt]);

  const getCurrentQuestionText = useCallback(() => {
    const q = interviewContext.questions[currentQuestionIndexRef.current];
    return q?.text?.trim() ?? "";
  }, [interviewContext.questions]);

  const playTTS = useCallback(async (text) => {
    const trimmed = text?.trim();
    if (!trimmed) return;

    if (process.env.NEXT_PUBLIC_ENABLE_VOICE === "false") return;

    interruptPlayback();
    setState((s) => ({ ...s, isSpeaking: true, aiTranscript: trimmed }));

    // Mute mic while speaking to prevent Chrome echo-cancellation from distorting audio
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getAudioTracks().forEach(t => { t.enabled = false; });
    }

    const voiceApiUrl = process.env.NEXT_PUBLIC_VOICE_API_URL || "http://localhost:8000";

    try {
      const ttsRes = await fetch(`${voiceApiUrl}/api/tts/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });

      if (ttsRes.ok && ttsRes.headers.get("content-type")?.includes("audio")) {
        const blob = await ttsRes.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          if (mediaStreamRef.current) {
            mediaStreamRef.current.getAudioTracks().forEach(t => { t.enabled = true; });
          }
          setState((s) => ({ ...s, isSpeaking: false, lastAssistantUtteranceEndedAt: Date.now() }));
          URL.revokeObjectURL(url);
        };
        audio.onerror = () => {
          if (mediaStreamRef.current) {
            mediaStreamRef.current.getAudioTracks().forEach(t => { t.enabled = true; });
          }
          setState((s) => ({ ...s, isSpeaking: false }));
          URL.revokeObjectURL(url);
        };
        await audio.play();
        return;
      }
    } catch (err) {
      log.warn("Backend TTS failed, using browser speech:", err);
    }

    const spoke = await speakWithBrowser(trimmed, language);
    
    // Unmute mic when done speaking to resume normal recording
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getAudioTracks().forEach(t => { t.enabled = true; });
    }

    setState((s) => ({
      ...s,
      isSpeaking: false,
      lastAssistantUtteranceEndedAt: spoke ? Date.now() : s.lastAssistantUtteranceEndedAt,
    }));
  }, [interruptPlayback, language]);

  const saveProgress = useCallback(async (currentQuestionIndex) => {
    // Progress is now saved via trpc in voice-interface.jsx's handleQuestionChange
    // This is just a noop wrapper to satisfy legacy disconnect() calls
  }, []);

  const getAIResponse = useCallback(async (userText, opts = {}) => {
    const qIndex = opts.questionIndex ?? currentQuestionIndexRef.current;
    setState((s) => ({ ...s, isProcessing: true }));

    try {
      const history = userText
        ? [...messagesRef.current, { role: "user", content: userText }]
        : messagesRef.current;

      const chatRes = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          interviewId,
          messages: history,
          currentQuestionIndex: qIndex,
        }),
      });

      if (!chatRes.ok) {
        const errBody = await chatRes.json().catch(() => ({}));
        throw new Error(errBody.error || "AI generation failed");
      }

      const chatData = await chatRes.json();
      const { content, questionAdvanced, isComplete } = chatData;
      const clean = (content ?? "").trim();

      if (userText) {
        trackedMessagesRef.current.push({ role: "user", content: userText });
      }
      if (clean) {
        trackedMessagesRef.current.push({ role: "assistant", content: clean });
        onAIResponse?.(clean);
      }

      setState((s) => ({
        ...s,
        aiTranscript: clean,
        isProcessing: false,
        isInterviewComplete: isComplete ? true : s.isInterviewComplete,
        currentQuestionIndex: questionAdvanced && !isComplete
          ? Math.min(qIndex + 1, s.totalQuestions - 1)
          : s.currentQuestionIndex,
      }));

      if (questionAdvanced && !isComplete) {
        const nextIdx = qIndex + 1;
        currentQuestionIndexRef.current = nextIdx;
        onQuestionChange?.(nextIdx, interviewContext.questions.length);
      }

      if (clean) {
        await playTTS(clean);
      }

      if (isComplete) {
        setState((s) => ({ ...s, isInterviewComplete: true }));
      }
    } catch (err) {
      log.error(err);
      setState((s) => ({ ...s, isProcessing: false }));
      onError?.("Network error: " + (err.message || "AI failed to respond"));
      
      // Auto-recover from network failure
      const errorMsg = "I'm sorry, my connection dropped. Could you please repeat your answer?";
      setState((s) => ({ ...s, aiTranscript: errorMsg }));
      await playTTS(errorMsg);
    }
  }, [sessionId, interviewId, interviewContext.questions.length, onAIResponse, onQuestionChange, onError, playTTS]);

  const transcribeWithBackend = useCallback(async (audioBlob) => {
    const voiceApiUrl = process.env.NEXT_PUBLIC_VOICE_API_URL || "http://localhost:8000";
    const formData = new FormData();
    formData.append("audio", audioBlob, recorderMimeRef.current.includes("webm") ? "audio.webm" : "audio.mp4");
    const sttRes = await fetch(`${voiceApiUrl}/api/speech/transcribe`, {
      method: "POST",
      body: formData,
    });
    if (!sttRes.ok) return null;
    const sttData = await sttRes.json();
    return sttData.success && sttData.text ? sttData.text.trim() : null;
  }, []);

  const processVoiceInput = useCallback(async (spokenText, audioBlob) => {
    setState((s) => ({ ...s, isProcessing: true, userTranscript: "" }));

    try {
      let text = spokenText?.trim() ?? "";

      if (!text && audioBlob && audioBlob.size >= 1000) {
        text = (await transcribeWithBackend(audioBlob)) ?? "";
      }

      if (!text) {
        setState((s) => ({ ...s, isProcessing: false }));
        return;
      }

      onTranscript?.(text, true);
      await saveProgress(currentQuestionIndexRef.current);
      await getAIResponse(text);
    } catch (err) {
      log.error(err);
      setState((s) => ({ ...s, isProcessing: false }));
      onError?.("Voice processing failed. " + (err.message || ""));
    }
  }, [getAIResponse, onTranscript, onError, saveProgress, transcribeWithBackend]);

  const connect = useCallback(async () => {
    try {
      if (process.env.NEXT_PUBLIC_ENABLE_VOICE === "false") {
        setState((s) => ({ ...s, isConnected: true }));
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;
      recorderMimeRef.current = pickRecorderMime();
      
      // Setup Web Audio API for Noise Gating
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;

      setState((s) => ({ ...s, isConnected: true }));
      log.info("Voice connected");
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        onError?.("PERMISSION_DENIED");
      } else {
        onError?.(err.message || "Failed to connect to microphone");
      }
    }
  }, [onError]);

  const greet = useCallback(async () => {
    if (greetingDoneRef.current || previewDisabled()) return;
    greetingDoneRef.current = true;

    const hasHistory = (messagesRef.current?.length ?? 0) > 0;
    if (hasHistory) {
      const lastAssistant = [...messagesRef.current].reverse().find((m) => m.role === "assistant");
      const toSpeak = lastAssistant?.content || getCurrentQuestionText();
      if (toSpeak) {
        setState((s) => ({ ...s, aiTranscript: toSpeak }));
        onAIResponse?.(toSpeak);
        await playTTS(toSpeak);
      }
      return;
    }

    await getAIResponse("", { questionIndex: currentQuestionIndexRef.current });
  }, [getAIResponse, getCurrentQuestionText, onAIResponse, playTTS]);

  function previewDisabled() {
    return sessionId === "__preview__";
  }

  const speakCurrentQuestion = useCallback(async () => {
    const qText = getCurrentQuestionText();
    if (qText) {
      setState((s) => ({ ...s, aiTranscript: qText }));
      await playTTS(qText);
    }
  }, [getCurrentQuestionText, playTTS]);

  const startListening = useCallback(() => {
    if (!mediaStreamRef.current && !isBrowserSTTAvailable()) return;

    interruptPlayback();
    browserTranscriptRef.current = "";
    setState((s) => ({ ...s, isListening: true, userTranscript: "" }));

    if (isBrowserSTTAvailable()) {
      try { browserRecognizerRef.current?.stop(); } catch { /* noop */ }

      const recognition = createBrowserRecognizer({
        lang: language,
        onInterim: (text) => {
          setState((s) => ({ ...s, userTranscript: browserTranscriptRef.current + (browserTranscriptRef.current ? " " : "") + text }));
        },
        onFinal: (text) => {
          browserTranscriptRef.current = browserTranscriptRef.current
            ? `${browserTranscriptRef.current} ${text}`.trim()
            : text;
          setState((s) => ({ ...s, userTranscript: browserTranscriptRef.current }));
        },
        onError: (code) => {
          if (code !== "aborted" && code !== "no-speech") {
            log.warn("Browser STT error:", code);
          }
        },
      });

      if (recognition) {
        browserRecognizerRef.current = recognition;
        try {
          recognition.start();
        } catch (err) {
          log.warn("Browser recognition start failed:", err);
        }
      }
    }

    if (mediaStreamRef.current) {
      try {
        const mime = recorderMimeRef.current;
        const recorder = new MediaRecorder(mediaStreamRef.current, mime ? { mimeType: mime } : undefined);
        mediaRecorderRef.current = recorder;
        audioChunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };
        recorder.start();
        
        // Start tracking volume
        if (analyserRef.current) {
          maxVolumeRef.current = 0;
          const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
          const updateVolume = () => {
            analyserRef.current.getByteTimeDomainData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              const val = (dataArray[i] - 128) / 128;
              sum += val * val;
            }
            const rms = Math.sqrt(sum / dataArray.length);
            if (rms > maxVolumeRef.current) {
              maxVolumeRef.current = rms;
            }
            volumeAnimationFrameRef.current = requestAnimationFrame(updateVolume);
          };
          updateVolume();
        }

      } catch (err) {
        log.warn("MediaRecorder fallback unavailable:", err);
      }
    }
  }, [interruptPlayback, language]);

  const stopListening = useCallback(() => {
    try { browserRecognizerRef.current?.stop(); } catch { /* noop */ }
    browserRecognizerRef.current = null;

    const spokenText = browserTranscriptRef.current;
    setState((s) => ({ ...s, isListening: false }));

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.onstop = async () => {
        if (volumeAnimationFrameRef.current) {
          cancelAnimationFrame(volumeAnimationFrameRef.current);
          volumeAnimationFrameRef.current = null;
        }
        
        const mime = recorderMimeRef.current || "audio/webm";
        const blob = new Blob(audioChunksRef.current, { type: mime });
        
        // Smart Noise Gating
        const maxVol = maxVolumeRef.current;
        if (maxVol < 0.02 && !spokenText) {
          log.info(`Audio discarded by noise gate (RMS peak: ${maxVol.toFixed(4)})`);
          return;
        }
        
        await processVoiceInput(spokenText, blob);
      };
      recorder.stop();
    } else if (spokenText) {
      void processVoiceInput(spokenText, null);
    } else {
      setState((s) => ({ ...s, isListening: false }));
    }
  }, [processVoiceInput]);

  const disconnect = useCallback(async () => {
    setState((s) => ({ ...s, isSaving: true }));
    try {
      await saveProgress(currentQuestionIndexRef.current);
    } finally {
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
      cleanup();
      setState((s) => ({ ...s, isSaving: false }));
    }
  }, [saveProgress, cleanup]);

  const nextQuestion = useCallback(async () => {
    interruptPlayback();
    const nextIdx = Math.min(currentQuestionIndexRef.current + 1, interviewContext.questions.length - 1);
    currentQuestionIndexRef.current = nextIdx;
    setState((s) => ({
      ...s,
      currentQuestionIndex: nextIdx,
      isTransitioning: false,
      transitionDirection: null,
      userTranscript: "",
      aiTranscript: "",
    }));
    onQuestionChange?.(nextIdx, interviewContext.questions.length);
    await saveProgress(nextIdx);
    await speakCurrentQuestion();
  }, [interruptPlayback, interviewContext.questions.length, onQuestionChange, saveProgress, speakCurrentQuestion]);

  const previousQuestion = useCallback(async () => {
    interruptPlayback();
    const prevIdx = Math.max(currentQuestionIndexRef.current - 1, 0);
    currentQuestionIndexRef.current = prevIdx;
    setState((s) => ({
      ...s,
      currentQuestionIndex: prevIdx,
      isTransitioning: false,
      transitionDirection: null,
      userTranscript: "",
      aiTranscript: "",
    }));
    onQuestionChange?.(prevIdx, interviewContext.questions.length);
    await saveProgress(prevIdx);
    await speakCurrentQuestion();
  }, [interruptPlayback, interviewContext.questions.length, onQuestionChange, saveProgress, speakCurrentQuestion]);

  const sendTextMessage = useCallback((text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onTranscript?.(trimmed, true);
    void saveProgress(currentQuestionIndexRef.current).then(() => {
      getAIResponse(trimmed);
    });
  }, [getAIResponse, onTranscript, saveProgress]);

  const sendCodeUpdate = useCallback(() => {}, []);
  const sendWhiteboardUpdate = useCallback(() => {}, []);

  return {
    ...state,
    connect,
    disconnect,
    greet,
    startListening,
    stopListening,
    nextQuestion,
    previousQuestion,
    sendTextMessage,
    sendCodeUpdate,
    sendWhiteboardUpdate,
    interruptPlayback,
    speakCurrentQuestion,
    mediaStreamRef,
  };
}
