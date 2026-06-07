"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createLogger } from '../lib/logger.js';

const log = createLogger("voice");

export function useVoice({
  sessionId,
  interviewId,
  interviewContext,
  onTranscript,
  onAIResponse,
  onError,
  onQuestionChange,
  messages,
}) {
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
    currentQuestionIndex: interviewContext.startQuestionIndex ?? 0,
    totalQuestions: interviewContext.questions.length,
  });

  const mediaStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioRef = useRef(null);
  const trackedMessagesRef = useRef([]);
  const messagesRef = useRef(messages || []);
  useEffect(() => { messagesRef.current = messages || []; }, [messages]);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  const cleanup = useCallback(() => {
    stopListening();
    interruptPlayback();
    setState(s => ({
      ...s,
      isConnected: false,
      isListening: false,
      isSpeaking: false,
      isProcessing: false,
    }));
  }, []);

  const interruptPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setState(s => ({ ...s, isSpeaking: false }));
  }, []);

  const connect = useCallback(async () => {
    try {
      if (process.env.NEXT_PUBLIC_ENABLE_VOICE === "false") {
        setState(s => ({ ...s, isConnected: true }));
        log.info("Text-only mode connected");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      setState(s => ({ ...s, isConnected: true }));
      log.info("Voice HTTP mode connected");
    } catch (err) {
      onError?.(err.message || "Failed to connect to microphone");
    }
  }, [onError]);

  const disconnect = useCallback(async () => {
    setState(s => ({ ...s, isSaving: true }));
    try {
      await saveProgress(state.currentQuestionIndex);
    } finally {
      cleanup();
    }
  }, [state.currentQuestionIndex, cleanup]);

  const saveProgress = useCallback(async (currentQuestionIndex) => {
    const messages = [...trackedMessagesRef.current];
    trackedMessagesRef.current = [];
    if (messages.length === 0) return;
    try {
      await fetch("/api/voice/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, messages, currentQuestionIndex }),
      });
    } catch (err) {
      log.error("Failed to save progress", err);
    }
  }, [sessionId]);

  const startListening = useCallback(() => {
    if (!mediaStreamRef.current) return;
    
    interruptPlayback();
    
    try {
      const mediaRecorder = new MediaRecorder(mediaStreamRef.current);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        if (audioBlob.size > 0) {
          await processVoiceInput(audioBlob);
        }
      };

      mediaRecorder.start();
      setState(s => ({ ...s, isListening: true, userTranscript: "", aiTranscript: "" }));
    } catch (err) {
      onError?.("Failed to start recording");
    }
  }, [interruptPlayback, onError]);

  const stopListening = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setState(s => ({ ...s, isListening: false }));
  }, []);

  const processVoiceInput = async (audioBlob) => {
    setState(s => ({ ...s, isProcessing: true }));
    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "audio.webm");

      const voiceApiUrl = process.env.NEXT_PUBLIC_VOICE_API_URL || "http://localhost:8000";
      const sttRes = await fetch(`${voiceApiUrl}/api/speech/transcribe`, {
        method: "POST",
        body: formData,
      });

      if (!sttRes.ok) throw new Error("Transcription failed");
      const sttData = await sttRes.json();
      
      if (sttData.success && sttData.text) {
        const text = sttData.text;
        onTranscript?.(text, true);
        trackedMessagesRef.current.push({ role: "user", content: text });
        
        await saveProgress(state.currentQuestionIndex);
        await getAIResponse(text);
      } else {
        setState(s => ({ ...s, isProcessing: false }));
      }
    } catch (err) {
      log.error(err);
      setState(s => ({ ...s, isProcessing: false }));
      onError?.("Voice processing failed. " + err.message);
    }
  };

  const getAIResponse = async (userText) => {
    try {
      const chatRes = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          interviewId,
          messages: [...messagesRef.current, { role: "user", content: userText }],
          currentQuestionIndex: state.currentQuestionIndex,
        }),
      });

      if (!chatRes.ok) throw new Error("AI generation failed");
      const chatData = await chatRes.json();
      
      const { content, questionAdvanced, isComplete } = chatData;
      
      setState(s => ({ ...s, aiTranscript: content, isProcessing: false }));
      onAIResponse?.(content);
      
      if (process.env.NEXT_PUBLIC_ENABLE_VOICE !== "false") { await playTTS(content); }

      if (isComplete) {
        setState(s => ({ ...s, isInterviewComplete: true }));
      } else if (questionAdvanced) {
        const nextIdx = state.currentQuestionIndex + 1;
        setState(s => ({ ...s, currentQuestionIndex: nextIdx }));
        onQuestionChange?.(nextIdx, state.totalQuestions);
      }
    } catch (err) {
      log.error(err);
      setState(s => ({ ...s, isProcessing: false }));
      onError?.("AI failed to respond");
    }
  };

  const playTTS = async (text) => {
    setState(s => ({ ...s, isSpeaking: true }));
    try {
      const voiceApiUrl = process.env.NEXT_PUBLIC_VOICE_API_URL || "http://localhost:8000";
      const ttsRes = await fetch(`${voiceApiUrl}/api/tts/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!ttsRes.ok) throw new Error("TTS failed");
      const blob = await ttsRes.blob();
      const url = URL.createObjectURL(blob);
      
      const audio = new Audio(url);
      audioRef.current = audio;
      
      audio.onended = () => {
        setState(s => ({ ...s, isSpeaking: false, lastAssistantUtteranceEndedAt: Date.now() }));
        URL.revokeObjectURL(url);
      };
      
      await audio.play();
    } catch (err) {
      log.error(err);
      setState(s => ({ ...s, isSpeaking: false }));
      onError?.("TTS failed");
    }
  };

  const nextQuestion = useCallback(async () => {
    setState(s => ({ ...s, isTransitioning: true, transitionDirection: "next" }));
    interruptPlayback();
    const nextIdx = state.currentQuestionIndex + 1;
    setState(s => ({ ...s, currentQuestionIndex: nextIdx, isTransitioning: false, transitionDirection: null }));
    onQuestionChange?.(nextIdx, state.totalQuestions);
    await saveProgress(nextIdx);
  }, [state.currentQuestionIndex, state.totalQuestions, saveProgress, interruptPlayback]);

  const previousQuestion = useCallback(async () => {
    setState(s => ({ ...s, isTransitioning: true, transitionDirection: "previous" }));
    interruptPlayback();
    const prevIdx = state.currentQuestionIndex - 1;
    setState(s => ({ ...s, currentQuestionIndex: prevIdx, isTransitioning: false, transitionDirection: null }));
    onQuestionChange?.(prevIdx, state.totalQuestions);
    await saveProgress(prevIdx);
  }, [state.currentQuestionIndex, state.totalQuestions, saveProgress, interruptPlayback]);

  const sendTextMessage = useCallback((text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    trackedMessagesRef.current.push({ role: "user", content: trimmed, source: "chat" });
    saveProgress(state.currentQuestionIndex).then(() => {
      getAIResponse(trimmed);
    });
  }, [state.currentQuestionIndex, saveProgress]);

  const sendCodeUpdate = useCallback((content, language) => {
    // Left empty since we aren't using the websocket anymore.
  }, []);

  const sendWhiteboardUpdate = useCallback((imageDataUrl) => {
    // Left empty since we aren't using the websocket anymore.
  }, []);

  return {
    ...state,
    connect,
    disconnect,
    startListening,
    stopListening,
    nextQuestion,
    previousQuestion,
    sendTextMessage,
    sendCodeUpdate,
    sendWhiteboardUpdate,
    interruptPlayback,
    mediaStreamRef,
  };
}
