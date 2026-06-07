"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  PlayCircle,
  Volume2,
  Code,
  FileText,
  PenTool,
  Mic,
  MicOff,
  Camera,
  Loader2,
  CheckCircle2
} from "lucide-react";
import { Whiteboard } from "./whiteboard.jsx";
import { useProctoring } from "../../hooks/use-proctoring.js";

// Same Questions from backend logic or static
const QUESTIONS = [
  {
    id: "q1", type: "THEORY", title: "Lists vs Tuples",
    text: "Explain the main differences between a List and a Tuple in Python. When would you choose to use one over the other?",
  },
  {
    id: "q2", type: "CODING", title: "Two Sum",
    text: "Write a function that takes an array of integers and a target, and returns the indices of the two numbers that add up to the target.",
    starterCode: "def two_sum(nums, target):\n    # Your solution here\n    pass\n\n# Example: two_sum([2, 7, 11, 15], 9) => [0, 1]",
  },
  {
    id: "q3", type: "THEORY", title: "Python GIL",
    text: "What is the Global Interpreter Lock (GIL) in Python? How does it affect multi-threading?",
  },
  {
    id: "q4", type: "CODING", title: "Valid Palindrome",
    text: "Write a function is_palindrome(s) that checks whether a given string is a valid palindrome.",
    starterCode: "def is_palindrome(s: str) -> bool:\n    # Your solution here\n    pass",
  },
  {
    id: "q5", type: "CODING", title: "Fibonacci Generator",
    text: "Implement a Python generator function fib_gen() that yields Fibonacci numbers indefinitely.",
    starterCode: "def fib_gen():\n    # Infinite generator\n    pass",
  },
];

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
      if (blob.size < 1000) return; // silence
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

export function IntegratedInterviewApp({ onComplete }) {
  const [activeTab, setActiveTab] = useState('text');
  const [textAnswer, setTextAnswer] = useState("");
  const [codeAnswer, setCodeAnswer] = useState("");
  const [codeLanguage, setCodeLanguage] = useState("python");
  const [isCompleted, setIsCompleted] = useState(false);
  
  const videoRef = useRef(null);

  const voice = useTestVoice({
    onTranscript: () => {},
    onAIResponse: () => {},
    onComplete: () => {
      setIsCompleted(true);
      onComplete?.();
    },
  });

  const {
    modelsReady,
    modelError,
    faceWarningActive,
    faceWarningMessage,
    phoneWarningActive
  } = useProctoring({ videoRef, active: true });

  const q = QUESTIONS[voice.currentQ];

  // Initialize Camera
  useEffect(() => {
    let stream = null;
    navigator.mediaDevices.getUserMedia({ video: true })
      .then((mediaStream) => {
        stream = mediaStream;
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      })
      .catch((err) => {
        console.error("Camera access denied", err);
      });

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    voice.connect().then(() => voice.greet());
  }, []); // eslint-disable-line

  useEffect(() => {
    setCodeAnswer(q?.starterCode || "");
    if (q?.type === 'CODING') {
      setActiveTab('code');
    } else {
      setActiveTab('text');
    }
  }, [voice.currentQ, q]);

  const handleSendText = () => {
    const text = textAnswer.trim();
    const code = codeAnswer.trim();
    if (!text && !code) return;
    let content = text;
    if (q?.type === "CODING" && code) {
      content = text ? `${text}\n\n\`\`\`python\n${code}\n\`\`\`` : `Here is my code:\n\`\`\`python\n${code}\n\`\`\``;
    }
    voice.sendText(content);
    setTextAnswer("");
  };

  if (isCompleted) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-white p-8">
        <CheckCircle2 className="w-20 h-20 text-indigo-500 mb-6" />
        <h1 className="text-4xl font-bold mb-4">Interview Completed</h1>
        <p className="text-slate-400 mb-8 text-center max-w-md text-lg">
          Thank you for your time. Your responses have been submitted successfully. You can now close this tab.
        </p>
        <button 
          className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-medium transition-colors"
          onClick={() => window.location.href = '/dashboard'}
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-950 text-slate-50 overflow-hidden font-sans relative">
      {/* Left Column: AI & Question */}
      <div className="flex flex-col w-[35%] min-w-[320px] max-w-[450px] bg-slate-900 border-r border-slate-800 p-6 shadow-2xl z-10">
        <div className="flex flex-col flex-1 gap-6">
          <div className="flex justify-between items-center bg-slate-800/50 p-4 rounded-2xl border border-slate-700/50 shadow-inner">
            <h2 className="text-xl font-bold bg-gradient-to-br from-indigo-300 to-purple-300 bg-clip-text text-transparent">
              Question {voice.currentQ + 1} / {QUESTIONS.length}
            </h2>
            <span className={`px-3 py-1 text-xs font-bold rounded-full tracking-wider ${q?.type === 'CODING' ? 'bg-indigo-900/80 text-indigo-300 border border-indigo-700/50' : 'bg-emerald-900/80 text-emerald-300 border border-emerald-700/50'}`}>
              {q?.type}
            </span>
          </div>

          <div className="flex flex-col items-center flex-1 justify-center relative">
            <div className="w-24 h-24 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center text-2xl font-black shadow-[0_0_40px_rgba(99,102,241,0.3)] mb-8 ring-4 ring-slate-900 ring-offset-4 ring-offset-indigo-500/20">
              AI
            </div>
            
            <div className="bg-slate-800/80 p-6 rounded-2xl border border-slate-700 shadow-xl relative w-full mb-8">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-6 h-6 bg-slate-800 border-t border-l border-slate-700 rotate-45 rounded-sm"></div>
              <p className="text-slate-200 text-[15px] leading-relaxed relative z-10">
                {voice.aiTranscript || "Hello! I am your AI interviewer."}
              </p>
              
              {voice.isProcessing && (
                <div className="flex gap-1.5 mt-4 justify-center">
                  {[0,1,2].map((i) => <div key={i} className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />)}
                </div>
              )}
            </div>

            <button 
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-xl text-sm font-medium transition-all shadow-md active:scale-95"
              onClick={() => voice.playTTS(voice.aiTranscript)}
              disabled={voice.isSpeaking || !voice.aiTranscript}
            >
              <Volume2 className="w-4 h-4 text-indigo-400" /> Replay Question
            </button>
          </div>

          <div className="flex flex-col gap-3 mt-auto pt-6 border-t border-slate-800/50">
            <button 
              className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl shadow-[0_4px_20px_-4px_rgba(79,70,229,0.5)] transition-all hover:-translate-y-0.5 active:translate-y-0"
              onClick={handleSendText}
            >
              Submit Answer
            </button>
            <button 
              className="w-full py-3.5 bg-transparent hover:bg-slate-800 border border-slate-700 text-slate-300 font-semibold rounded-xl transition-all"
              onClick={() => setIsCompleted(true)}
            >
              End Interview
            </button>
          </div>
        </div>
      </div>
      
      {/* Right Column: Workspace */}
      <div className="flex-1 flex flex-col bg-slate-950 p-6 gap-4">
        <div className="flex bg-slate-900/50 p-1.5 rounded-xl border border-slate-800 w-fit backdrop-blur-sm shadow-sm">
          <button 
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'text' ? 'bg-indigo-600 shadow-md text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}
            onClick={() => setActiveTab('text')}
          >
            <FileText className="w-4 h-4" /> Text Answer
          </button>
          <button 
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'code' ? 'bg-indigo-600 shadow-md text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}
            onClick={() => setActiveTab('code')}
          >
            <Code className="w-4 h-4" /> Code Editor
          </button>
          <button 
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'whiteboard' ? 'bg-indigo-600 shadow-md text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}
            onClick={() => setActiveTab('whiteboard')}
          >
            <PenTool className="w-4 h-4" /> Whiteboard
          </button>
        </div>
        
        <div className="flex-1 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden flex flex-col relative">
          {activeTab === 'text' && (
            <div className="flex flex-col h-full p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-slate-200">Written Response</h3>
                <button 
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all shadow-md ${voice.isListening ? 'bg-red-500/20 text-red-400 border border-red-500/50 animate-pulse' : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'}`}
                  onMouseDown={() => voice.startListening()}
                  onMouseUp={() => voice.stopListening()}
                  onMouseLeave={() => voice.isListening && voice.stopListening()}
                >
                  {voice.isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  {voice.isListening ? "Listening..." : "Hold to Speak"}
                </button>
              </div>
              <textarea 
                className="flex-1 w-full bg-slate-950/50 border border-slate-800 rounded-xl p-4 text-slate-200 placeholder:text-slate-600 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/50 text-base leading-relaxed transition-all"
                placeholder="Type your explanation here, or use the 'Hold to Speak' button to dictate..."
                value={textAnswer}
                onChange={(e) => setTextAnswer(e.target.value)}
              />
            </div>
          )}
          {activeTab === 'code' && (
            <div className="flex flex-col h-full bg-slate-950/80">
              <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <Code className="w-5 h-5 text-indigo-400" />
                  <span className="font-semibold text-slate-200">Interactive Editor</span>
                </div>
                <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg px-2">
                  <span className="text-xs text-slate-500 font-medium pl-2">Language:</span>
                  <select 
                    className="bg-transparent text-sm text-slate-300 font-medium p-2 focus:outline-none appearance-none cursor-pointer"
                    value={codeLanguage} 
                    onChange={(e) => setCodeLanguage(e.target.value)}
                  >
                    <option value="python">Python</option>
                    <option value="javascript">JavaScript</option>
                    <option value="java">Java</option>
                    <option value="cpp">C++</option>
                  </select>
                </div>
              </div>
              <textarea 
                className="flex-1 w-full bg-transparent p-6 text-slate-300 font-mono text-[14px] leading-relaxed resize-none focus:outline-none selection:bg-indigo-500/30"
                placeholder={`# Write your ${codeLanguage} code here...`}
                spellCheck="false"
                value={codeAnswer}
                onChange={(e) => setCodeAnswer(e.target.value)}
                style={{ tabSize: 4 }}
              />
            </div>
          )}
          {activeTab === 'whiteboard' && (
            <Whiteboard />
          )}
        </div>
      </div>
      
      {/* Floating Camera Section in Top Right */}
      <div className="absolute top-6 right-6 w-[260px] bg-slate-900 border border-slate-700 rounded-2xl shadow-[0_20px_40px_-10px_rgba(0,0,0,0.5)] overflow-hidden z-50 transition-all hover:shadow-[0_20px_40px_-10px_rgba(0,0,0,0.7)] hover:border-slate-600">
        <div className="flex items-center justify-between px-3 py-2.5 bg-slate-800/80 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-indigo-400" />
            <span className="text-xs font-semibold text-slate-200 tracking-wide uppercase">Proctoring</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${modelsReady ? 'bg-green-400' : 'bg-amber-400'}`}></span>
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${modelsReady ? 'bg-green-500' : 'bg-amber-500'}`}></span>
            </span>
          </div>
        </div>
        
        <div className="relative aspect-video bg-black">
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            muted 
            className="w-full h-full object-cover transform scale-x-[-1]" 
          />
          
          {/* AI Warnings Overlays */}
          {phoneWarningActive ? (
            <div className="absolute inset-0 bg-red-500/80 backdrop-blur-sm flex flex-col items-center justify-center p-4 text-center animate-pulse">
              <span className="text-4xl mb-2">📱</span>
              <span className="text-white font-bold text-sm tracking-wide">Phone Detected!</span>
            </div>
          ) : faceWarningActive ? (
            <div className="absolute inset-0 bg-red-500/80 backdrop-blur-sm flex flex-col items-center justify-center p-4 text-center">
              <span className="text-white font-bold text-xs leading-snug">{faceWarningMessage}</span>
            </div>
          ) : null}
        </div>
        
        {modelError && (
          <div className="p-2 bg-red-950/50 border-t border-red-900 text-[10px] text-red-400">
            {modelError}
          </div>
        )}
      </div>
    </div>
  );
}
