import { useState, useEffect, useRef } from 'react';
import { PlayCircle, Volume2, Code, FileText, PenTool, Eraser, Mic, MicOff, Camera } from 'lucide-react';
import * as tf from '@tensorflow/tfjs';
import * as blazeface from '@tensorflow-models/blazeface';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import './App.css';

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

  const [modelError, setModelError] = useState(null);

  // Load AI Models on Mount
  useEffect(() => {
    const loadModels = async () => {
      try {
        console.log("Starting to load AI models...");
        await tf.ready();
        console.log("TF is ready");
        const fModel = await blazeface.load();
        console.log("Blazeface loaded");
        setFaceModel(fModel);
        
        const oModel = await cocoSsd.load();
        console.log("Coco SSD loaded");
        setObjectModel(oModel);
        
        console.log("AI Models loaded successfully");
      } catch (err) {
        console.error("Failed to load AI models", err);
        setModelError(err.message || "Failed to load models. Check console.");
      }
    };
    loadModels();
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

  // AI Detection Interval (1 fps)
  useEffect(() => {
    if (interviewStarted && !interviewCompleted && !interviewTerminated && faceModel && objectModel && videoRef.current) {
      detectionInterval.current = setInterval(async () => {
        if (videoRef.current && videoRef.current.readyState === 4) {
          try {
            // 1. Face Detection
            const facePredictions = await faceModel.estimateFaces(videoRef.current, false);
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
              // Exactly 1 face
              missingFaceCount.current = 0;
              setFaceWarningActive(false);
            }

            // 2. Phone Detection
            const objPredictions = await objectModel.detect(videoRef.current);
            const phoneDetected = objPredictions.some(pred => pred.class === 'cell phone');
            
            if (phoneDetected) {
              setPhoneWarningActive(true);
            } else {
              setPhoneWarningActive(false);
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

    return () => {
      if (speechSynthRef.current) {
        speechSynthRef.current.cancel();
      }
      if (recognitionRef.current && isRecording) {
        recognitionRef.current.stop();
        setIsRecording(false);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

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
          }
        }
      }
    };

    document.addEventListener('fullscreenchange', handleFullScreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullScreenChange);
      if (timerRef.current) clearInterval(timerRef.current);
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
          {/* Left Column: AI & Question */}
          <div className="sidebar-section">
            <div className="question-header">
              <h2>Question {currentStep + 1} / {interviewFlow.length}</h2>
              <span className={`badge ${interviewFlow[currentStep].type}`}>
                {interviewFlow[currentStep].type.toUpperCase()}
              </span>
            </div>

            <div className="interviewer-section-vertical">
              <div className="avatar-placeholder">AI</div>
              <div className="interviewer-bubble">
                <p>{interviewFlow[currentStep].interviewer}</p>
                <button 
                  className="replay-voice-btn" 
                  onClick={() => speakQuestion(interviewFlow[currentStep].interviewer)}
                  title="Replay Voice"
                >
                  <Volume2 size={16} /> Replay
                </button>
              </div>
            </div>
            <div className="sidebar-footer" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button className="primary-btn submit-btn" onClick={submitAnswer}>
                {currentStep === interviewFlow.length - 1 ? "Submit & Finish" : "Submit Answer"}
              </button>
              {currentStep < interviewFlow.length - 1 && (
                <button 
                  className="secondary-btn" 
                  style={{ padding: '12px', borderRadius: '8px', border: '1px solid #475569', backgroundColor: 'transparent', color: '#f8fafc', cursor: 'pointer', fontSize: '1rem', fontWeight: '500' }} 
                  onClick={nextQuestion}
                >
                  Next Question
                </button>
              )}
              <button 
                className="danger-btn" 
                style={{ padding: '12px', borderRadius: '8px', border: 'none', backgroundColor: '#ef4444', color: 'white', cursor: 'pointer', fontSize: '1rem', fontWeight: '500' }} 
                onClick={endInterview}
              >
                End Interview
              </button>
            </div>
          </div>
          
          {/* Right Column: Workspace (Tabs) */}
          <div className="candidate-section workspace-section">
            <div className="workspace-tabs">
              <button 
                className={`tab-btn ${activeTab === 'text' ? 'active' : ''}`}
                onClick={() => setActiveTab('text')}
              >
                <FileText size={16} /> Text Answer
              </button>
              <button 
                className={`tab-btn ${activeTab === 'code' ? 'active' : ''}`}
                onClick={() => setActiveTab('code')}
              >
                <Code size={16} /> Code Editor
              </button>
              <button 
                className={`tab-btn ${activeTab === 'whiteboard' ? 'active' : ''}`}
                onClick={() => setActiveTab('whiteboard')}
              >
                <PenTool size={16} /> Whiteboard
              </button>
            </div>
            
            <div className="workspace-content">
              {activeTab === 'text' && (
                <div className="tab-pane">
                  <div className="workspace-toolbar">
                    <button 
                      className={`tool-btn record-btn ${isRecording ? 'recording' : ''}`} 
                      onClick={toggleRecording}
                    >
                      {isRecording ? <MicOff size={16} /> : <Mic size={16} />}
                      {isRecording ? "Stop Recording" : "Speak Answer"}
                    </button>
                    {isRecording && <span className="recording-status">Listening...</span>}
                  </div>
                  <textarea 
                    className="text-answer with-toolbar" 
                    placeholder="Type your explanation here, or click 'Speak Answer' to dictate your thoughts..."
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                  />
                </div>
              )}
              {activeTab === 'code' && (
                <div className="tab-pane">
                  <div className="workspace-toolbar">
                    <span className="toolbar-label">Language:</span>
                    <select 
                      className="language-select" 
                      value={codeLanguage} 
                      onChange={(e) => setCodeLanguage(e.target.value)}
                    >
                      <option value="javascript">JavaScript</option>
                      <option value="python">Python</option>
                      <option value="java">Java</option>
                      <option value="cpp">C++</option>
                      <option value="typescript">TypeScript</option>
                    </select>
                  </div>
                  <textarea 
                    className="code-editor with-toolbar" 
                    placeholder={`// Write your ${codeLanguage} code here...`}
                    spellCheck="false"
                    value={codeAnswer}
                    onChange={(e) => setCodeAnswer(e.target.value)}
                  />
                </div>
              )}
              {activeTab === 'whiteboard' && (
                <Whiteboard />
              )}
            </div>
          </div>
          
          {/* Floating Camera Section in Top Right */}
          <div 
            className="camera-section floating-camera" 
            style={{ 
              position: 'absolute', 
              top: '1.5rem', 
              right: '1.5rem', 
              width: '240px', 
              padding: 0, 
              borderRadius: '12px', 
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)', 
              border: '1px solid #475569',
              zIndex: 100,
              overflow: 'hidden'
            }}
          >
            <div className="camera-header" style={{ padding: '0.5rem 1rem', backgroundColor: 'rgba(15, 23, 42, 0.95)', borderBottom: '1px solid #334155', marginBottom: 0 }}>
              <Camera size={14} /> Candidate View
            </div>
            <div className="camera-view" style={{ borderRadius: '0', border: 'none' }}>
              {cameraError ? (
                <div className="camera-error">
                  <p>Camera access denied</p>
                </div>
              ) : (
                <video ref={videoRef} autoPlay playsInline muted className="candidate-video" />
              )}
              
              {/* AI Detection Warnings Overlays */}
              {phoneWarningActive ? (
                <div className="face-warning-overlay">
                  📱 Phone Detected!
                </div>
              ) : faceWarningActive ? (
                <div className="face-warning-overlay" style={{ fontSize: '0.8rem' }}>
                  {faceWarningMessage}
                </div>
              ) : null}
              
            </div>
          </div>
        </div>
      )}

      {warningActive && (
        <div className="warning-modal-overlay">
          <div className="warning-modal">
            <h2>⚠️ Warning!</h2>
            <p>You have navigated away from the full screen assessment.</p>
            <p className="countdown">Returning in <span>{warningTimeLeft}</span> seconds...</p>
            <p>If you do not return, your interview will be terminated automatically.</p>
            <button className="danger-btn" onClick={returnToFullScreen}>Return to Full Screen Now</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
