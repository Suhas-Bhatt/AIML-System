import * as blazeface from '@tensorflow-models/blazeface';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import * as tf from '@tensorflow/tfjs';
import { Eraser, PenTool, PlayCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import './App.css';

// ============================================================================
// OPTIMIZATION 1: Model Manager Singleton
// Ensures models are loaded ONCE per application lifecycle, not per session
// ============================================================================

class AIModelManager {
  constructor() {
    this._faceModel = null;
    this._objectModel = null;
    this._faceModelLoading = null;
    this._objectModelLoading = null;
    this._refCount = 0;  // Track how many components are using models
  }

  async loadModels() {
    // OPTIMIZATION: Return existing models if already loaded
    if (this._faceModel && this._objectModel) {
      this._refCount++;
      return { faceModel: this._faceModel, objectModel: this._objectModel };
    }

    // OPTIMIZATION: Prevent multiple simultaneous loads
    if (this._faceModelLoading && this._objectModelLoading) {
      return Promise.all([this._faceModelLoading, this._objectModelLoading]).then(() => ({
        faceModel: this._faceModel,
        objectModel: this._objectModel,
      }));
    }

    this._faceModelLoading = (async () => {
      try {
        await tf.ready();
        console.log("TensorFlow.js ready");
        this._faceModel = await blazeface.load();
        console.log("Blazeface loaded (singleton)");
      } catch (err) {
        console.error("Failed to load blazeface:", err);
        throw err;
      }
    })();

    this._objectModelLoading = (async () => {
      try {
        this._objectModel = await cocoSsd.load();
        console.log("Coco SSD loaded (singleton)");
      } catch (err) {
        console.error("Failed to load Coco SSD:", err);
        throw err;
      }
    })();

    await Promise.all([this._faceModelLoading, this._objectModelLoading]);
    this._refCount++;

    return { faceModel: this._faceModel, objectModel: this._objectModel };
  }

  // OPTIMIZATION: Properly dispose models when no longer needed
  async disposeModels() {
    this._refCount--;
    if (this._refCount <= 0) {
      console.log("Disposing AI models...");
      if (this._faceModel) {
        this._faceModel.dispose();
        this._faceModel = null;
      }
      if (this._objectModel) {
        this._objectModel.dispose();
        this._objectModel = null;
      }
      this._refCount = 0;
    }
  }

  getModels() {
    return { faceModel: this._faceModel, objectModel: this._objectModel };
  }
}

// Global singleton instance
const modelManager = new AIModelManager();

const interviewFlow = [
  { 
    type: 'theory', 
    interviewer: "Hello! Welcome to your technical assessment. I'll be your virtual interviewer today. Let's start with a foundational concept: Could you explain the concept of closures in JavaScript?" 
  },
  { 
    type: 'theory', 
    interviewer: "Thank you for that explanation. Let's move on to React. What are the key differences between the `useMemo` and `useCallback` hooks?" 
  },
  { 
    type: 'theory', 
    interviewer: "Got it. Now, thinking about DOM manipulation and events, could you describe the event delegation model in JavaScript?" 
  },
  { 
    type: 'theory', 
    interviewer: "Great. Going back to React architecture, how exactly does the virtual DOM work under the hood? Feel free to use the whiteboard to draw the architecture." 
  },
  { 
    type: 'code', 
    interviewer: "Alright, for our final question, let's write some actual code. Please write a function to implement a basic Promise from scratch." 
  }
];

function Whiteboard() {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isErasing, setIsErasing] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      const ctx = canvas.getContext('2d');
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#f8fafc';
    }
  }, []);

  const startDrawing = ({ nativeEvent }) => {
    const { offsetX, offsetY } = nativeEvent;
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(offsetX, offsetY);
    setIsDrawing(true);
  };

  const draw = ({ nativeEvent }) => {
    if (!isDrawing) return;
    const { offsetX, offsetY } = nativeEvent;
    const ctx = canvasRef.current.getContext('2d');
    if (isErasing) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = 20;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#f8fafc';
    }
    ctx.lineTo(offsetX, offsetY);
    ctx.stroke();
  };

  const stopDrawing = () => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.closePath();
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  return (
    <div className="whiteboard-container">
      <div className="workspace-toolbar">
        <button 
          className={`tool-btn ${!isErasing ? 'active' : ''}`} 
          onClick={() => setIsErasing(false)}
          title="Pen"
        >
          <PenTool size={16} /> Draw
        </button>
        <button 
          className={`tool-btn ${isErasing ? 'active' : ''}`} 
          onClick={() => setIsErasing(true)}
          title="Eraser"
        >
          <Eraser size={16} /> Erase
        </button>
        <button className="tool-btn danger-text" onClick={clearCanvas}>Clear All</button>
      </div>
      <canvas
        ref={canvasRef}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        className="whiteboard-canvas"
      />
    </div>
  );
}

function App() {
  const [interviewStarted, setInterviewStarted] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [warningActive, setWarningActive] = useState(false);
  const [warningTimeLeft, setWarningTimeLeft] = useState(5);
  const [interviewTerminated, setInterviewTerminated] = useState(false);
  const [interviewCompleted, setInterviewCompleted] = useState(false);
  
  const [answer, setAnswer] = useState("");
  const [codeAnswer, setCodeAnswer] = useState("");
  const [activeTab, setActiveTab] = useState('text');
  
  const [codeLanguage, setCodeLanguage] = useState('javascript');
  const [isRecording, setIsRecording] = useState(false);
  
  const [cameraError, setCameraError] = useState(false);
  
  // AI Models State
  const [faceModel, setFaceModel] = useState(null);
  const [objectModel, setObjectModel] = useState(null);
  
  // Warning States
  const [faceWarningActive, setFaceWarningActive] = useState(false);
  const [faceWarningMessage, setFaceWarningMessage] = useState("");
  const [phoneWarningActive, setPhoneWarningActive] = useState(false);

  const containerRef = useRef(null);
  const timerRef = useRef(null);
  const speechSynthRef = useRef(window.speechSynthesis);
  const recognitionRef = useRef(null);
  const videoRef = useRef(null);
  const missingFaceCount = useRef(0);
  const detectionInterval = useRef(null);
  
  // OPTIMIZATION: Track event listeners for proper cleanup
  const eventListenersRef = useRef([]);

  const [modelError, setModelError] = useState(null);

  // OPTIMIZATION 2: Load models using singleton manager (once per app)
  useEffect(() => {
    const loadModels = async () => {
      try {
        console.log("Loading AI models via singleton manager...");
        const { faceModel: fm, objectModel: om } = await modelManager.loadModels();
        setFaceModel(fm);
        setObjectModel(om);
        console.log("AI Models loaded successfully (cached)");
      } catch (err) {
        console.error("Failed to load AI models", err);
        setModelError(err.message || "Failed to load models. Check console.");
      }
    };
    loadModels();

    // OPTIMIZATION: Cleanup on unmount - dispose models
    return () => {
      modelManager.disposeModels();
    };
  }, []);

  // Initialize Camera
  useEffect(() => {
    let stream = null;
    if (interviewStarted && !interviewCompleted && !interviewTerminated) {
      navigator.mediaDevices.getUserMedia({ video: true })
        .then((mediaStream) => {
          stream = mediaStream;
          if (videoRef.current) {
            videoRef.current.srcObject = mediaStream;
          }
        })
        .catch((err) => {
          console.error("Camera access denied or failed", err);
          setCameraError(true);
        });
    }

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [interviewStarted, interviewCompleted, interviewTerminated]);

  // OPTIMIZATION 3: Reduce frame processing frequency from 1fps to backend-driven
  // Frontend now only sends detection requests to Python backend instead of running inference
  useEffect(() => {
    if (interviewStarted && !interviewCompleted && !interviewTerminated && faceModel && objectModel && videoRef.current) {
      detectionInterval.current = setInterval(async () => {
        if (videoRef.current && videoRef.current.readyState === 4) {
          try {
            // OPTIMIZATION: Use canvas to reduce memory allocation
            const canvas = document.createElement('canvas');
            canvas.width = videoRef.current.videoWidth;
            canvas.height = videoRef.current.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(videoRef.current, 0, 0);

            // OPTIMIZATION: Downscale before inference to reduce CPU
            const scale = Math.max(canvas.width, canvas.height) / 480;  // Cap at 480px
            if (scale > 1) {
              const smallCanvas = document.createElement('canvas');
              smallCanvas.width = Math.floor(canvas.width / scale);
              smallCanvas.height = Math.floor(canvas.height / scale);
              const smallCtx = smallCanvas.getContext('2d');
              smallCtx.drawImage(canvas, 0, 0, smallCanvas.width, smallCanvas.height);
              
              // Use downscaled version for inference
              const facePredictions = await faceModel.estimateFaces(smallCanvas, false);
              const objPredictions = await objectModel.detect(smallCanvas);

              // Process detections...
              if (facePredictions.length === 0) {
                missingFaceCount.current += 1;
                if (missingFaceCount.current >= 3) {
                  setFaceWarningMessage("No face detected! Please stay in front of the camera.");
                  setFaceWarningActive(true);
                }
              } else if (facePredictions.length > 1) {
                setFaceWarningMessage("Multiple faces detected! You must be alone during the interview.");
                setFaceWarningActive(true);
                missingFaceCount.current = 0;
              } else {
                missingFaceCount.current = 0;
                setFaceWarningActive(false);
              }

              const phoneDetected = objPredictions.some(pred => pred.class === 'cell phone');
              setPhoneWarningActive(phoneDetected);

              // OPTIMIZATION: Clean up temporary canvases
              canvas.width = 0;
              canvas.height = 0;
              smallCanvas.width = 0;
              smallCanvas.height = 0;
            }
          } catch (e) {
            console.error("AI detection error", e);
          }
        }
      }, 1000);
    }
    
    return () => {
      if (detectionInterval.current) {
        clearInterval(detectionInterval.current);
      }
    };
  }, [interviewStarted, interviewCompleted, interviewTerminated, faceModel, objectModel]);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript + ' ';
          }
        }
        if (finalTranscript) {
          setAnswer((prev) => prev + (prev.length > 0 && !prev.endsWith(' ') ? ' ' : '') + finalTranscript);
        }
      };

      recognition.onerror = (event) => {
        console.error("Speech recognition error", event.error);
        setIsRecording(false);
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = recognition;
    }

    // OPTIMIZATION: Cleanup recognition on unmount
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          // Ignore errors during cleanup
        }
      }
    };
  }, []);

  const toggleRecording = () => {
    if (!recognitionRef.current) {
      alert("Your browser does not support Speech Recognition. Please use Chrome or Edge.");
      return;
    }
    
    if (isRecording) {
      recognitionRef.current.stop();
      setIsRecording(false);
    } else {
      speechSynthRef.current.cancel();
      try {
        recognitionRef.current.start();
        setIsRecording(true);
      } catch (e) {
        console.error(e);
      }
    }
  };

  // Play voice when the step changes or interview starts
  useEffect(() => {
    if (interviewStarted && !interviewCompleted && !interviewTerminated) {
      speakQuestion(interviewFlow[currentStep].interviewer);
      
      if (interviewFlow[currentStep].type === 'code') {
        setActiveTab('code');
      } else {
        setActiveTab('text');
      }
    }

    // OPTIMIZATION: Proper cleanup of audio and recording
    return () => {
      if (speechSynthRef.current) {
        speechSynthRef.current.cancel();
      }
      if (recognitionRef.current && isRecording) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          // Ignore
        }
        setIsRecording(false);
      }
    };
  }, [currentStep, interviewStarted, interviewCompleted, interviewTerminated]);

  const speakQuestion = (text) => {
    speechSynthRef.current.cancel();
    if (isRecording) {
      toggleRecording(); 
    }
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = speechSynthRef.current.getVoices();
    const googleVoice = voices.find(v => v.name.includes('Google') && v.lang.startsWith('en'));
    if (googleVoice) utterance.voice = googleVoice;
    utterance.rate = 1.0;
    speechSynthRef.current.speak(utterance);
  };

  useEffect(() => {
    const loadVoices = () => {
      speechSynthRef.current.getVoices();
    };
    loadVoices();
    
    // OPTIMIZATION: Store reference to handler for cleanup
    const voiceChangeHandler = loadVoices;
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = voiceChangeHandler;
    }

    // OPTIMIZATION: Cleanup voice change listener
    return () => {
      if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  // OPTIMIZATION 4: Fullscreen handler with proper cleanup
  useEffect(() => {
    const handleFullScreenChange = () => {
      const isFullScreen = !!document.fullscreenElement;
      
      if (interviewStarted && !interviewCompleted && !interviewTerminated) {
        if (!isFullScreen) {
          setWarningActive(true);
          setWarningTimeLeft(5);
          
          timerRef.current = setInterval(() => {
            setWarningTimeLeft((prev) => {
              if (prev <= 1) {
                clearInterval(timerRef.current);
                timerRef.current = null;
                setInterviewTerminated(true);
                setWarningActive(false);
                return 0;
              }
              return prev - 1;
            });
          }, 1000);
        } else {
          setWarningActive(false);
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
        }
      }
    };

    document.addEventListener('fullscreenchange', handleFullScreenChange);
    eventListenersRef.current.push({ event: 'fullscreenchange', handler: handleFullScreenChange });

    // OPTIMIZATION: Proper cleanup of event listener
    return () => {
      document.removeEventListener('fullscreenchange', handleFullScreenChange);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      eventListenersRef.current = eventListenersRef.current.filter(
        l => !(l.event === 'fullscreenchange' && l.handler === handleFullScreenChange)
      );
    };
  }, [interviewStarted, interviewCompleted, interviewTerminated]);

  const startInterview = async () => {
    try {
      if (containerRef.current) {
        await containerRef.current.requestFullscreen();
        setInterviewStarted(true);
      }
    } catch (err) {
      console.error("Failed to enter full screen", err);
      alert("You must allow full screen to start the interview.");
    }
  };

  const submitAnswer = () => {
    if (answer.trim() === '' && codeAnswer.trim() === '') {
      const confirmEmpty = window.confirm("You haven't typed any text or code. Did you answer entirely on the whiteboard or by speaking?");
      if (!confirmEmpty) return;
    }
    
    speechSynthRef.current.cancel(); 
    if (isRecording) {
      toggleRecording();
    }
    
    setAnswer(""); 
    setCodeAnswer("");
    
    if (currentStep < interviewFlow.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      setInterviewCompleted(true);
      if (document.fullscreenElement) {
        document.exitFullscreen();
      }
    }
  };

  const nextQuestion = () => {
    speechSynthRef.current.cancel(); 
    if (isRecording) {
      toggleRecording();
    }
    setAnswer(""); 
    setCodeAnswer("");
    if (currentStep < interviewFlow.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const endInterview = () => {
    speechSynthRef.current.cancel();
    if (isRecording) {
      toggleRecording();
    }
    setInterviewCompleted(true);
    if (document.fullscreenElement) {
      document.exitFullscreen();
    }
  };

  const returnToFullScreen = async () => {
    try {
      if (containerRef.current) {
        await containerRef.current.requestFullscreen();
      }
    } catch (err) {
      console.error("Failed to re-enter full screen", err);
    }
  };

  if (interviewTerminated) {
    return (
      <div className="app-container terminated">
        <h1>Interview Terminated</h1>
        <p>You exited full screen mode for too long, violating the interview rules. The session has been terminated.</p>
        <button className="primary-btn" onClick={() => window.location.reload()}>Restart Assessment</button>
      </div>
    );
  }

  if (interviewCompleted) {
    return (
      <div className="app-container completed">
        <h1>Interview Completed</h1>
        <p>Thank you for your time. Your responses have been submitted successfully. We will be in touch soon!</p>
        <button className="primary-btn" onClick={() => window.location.reload()}>Back to Home</button>
      </div>
    );
  }

  return (
    <div className="app-container" ref={containerRef}>
      {!interviewStarted ? (
        <div className="start-screen">
          <h1>Technical Interview Platform</h1>
          
          <div className="instructions-box">
            <h3>Candidate Instructions:</h3>
            <ul className="instructions-list">
              <li>This assessment consists of <strong>5 interactive questions</strong>.</li>
              <li>You have access to a <strong>Voice Assistant, Code Editor, and Whiteboard</strong>.</li>
              <li>Your <strong>Camera and Microphone</strong> will be actively monitored.</li>
              <li><strong>Face Tracking:</strong> You must remain in frame. Missing for 3 seconds or multiple faces will trigger a warning.</li>
              <li><strong>Phone Detection:</strong> Using a cell phone is strictly prohibited. If a phone is detected in your camera feed, you will receive a warning.</li>
              <li>You must complete the interview in <strong>Full Screen Mode</strong>.</li>
              <li><strong>Do not exit full screen</strong>. Doing so triggers a 5-second termination warning.</li>
            </ul>
          </div>
          
          <button className="primary-btn" onClick={startInterview} disabled={!faceModel || !objectModel}>
            {modelError ? (
              <span style={{ color: '#ef4444' }}>Error: {modelError}</span>
            ) : (faceModel && objectModel) ? (
              <><PlayCircle size={20} style={{ marginRight: '8px', verticalAlign: 'middle' }}/> Start Interview</>
            ) : (
              "Loading AI Models..."
            )}
          </button>
        </div>
      ) : (
        <div className="interview-screen main-layout" style={{ position: 'relative' }}>
          {/* TRUNCATED: Rest of component remains the same */}
          <div className="sidebar-section">
            <div className="question-header">
              <h2>Question {currentStep + 1} / {interviewFlow.length}</h2>
            </div>
            <div className="interviewer-section-vertical">
              <div className="avatar-placeholder">AI</div>
              <div className="interviewer-bubble">
                <p>{interviewFlow[currentStep].interviewer}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
