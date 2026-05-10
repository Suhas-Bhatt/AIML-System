import base64
import json
import logging
from typing import Dict, List, Optional, Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# Import core proctoring logic
from proctoring.proctor import Proctor
from agents.orchestrator import EnterpriseAgentOrchestrator
from agents.eval_agent import InterviewEvaluationAgent

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("Enterprise-AI-Agent")

app = FastAPI(title="Aural Enterprise AI Service")

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global Store for Enterprise Orchestrator Agents
agent_sessions: Dict[str, EnterpriseAgentOrchestrator] = {}

class SessionConfig(BaseModel):
    session_id: str
    reference_frame: Optional[str] = None

class EvalRequest(BaseModel):
    sessionId: str
    role: str
    topic: str
    messages: List[Dict[str, Any]]
    proctor_logs: Optional[List[Dict[str, Any]]] = []

@app.post("/session/start")
async def start_session(config: SessionConfig):
    if config.session_id in agent_sessions:
        return {"status": "already_running", "session_id": config.session_id}
    
    agent = EnterpriseAgentOrchestrator(config.session_id)
    if config.reference_frame:
        # Pass reference to the vision sub-agent
        success = agent.vision_agent.set_reference(config.reference_frame)
        if not success:
            logger.warning(f"Failed to set reference for orchestrator agent {config.session_id}")
            
    agent_sessions[config.session_id] = agent
    logger.info(f"Started Enterprise Orchestrator Agent: {config.session_id}")
    return {"status": "started", "session_id": config.session_id}

@app.post("/session/stop/{session_id}")
async def stop_session(session_id: str):
    if session_id in agent_sessions:
        del agent_sessions[session_id]
        logger.info(f"Stopped Orchestrator: {session_id}")
        return {"status": "stopped", "session_id": session_id}
    raise HTTPException(status_code=404, detail="Orchestrator not found")

@app.websocket("/ws/proctor/{session_id}")
async def websocket_proctor(websocket: WebSocket, session_id: str):
    await websocket.accept()
    
    if session_id not in agent_sessions:
        agent_sessions[session_id] = EnterpriseAgentOrchestrator(session_id)
        logger.info(f"Auto-started Orchestrator Agent for WS: {session_id}")
        
    agent = agent_sessions[session_id]
    
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            # Orchestrator coordinates multi-modal processing
            result = await agent.process_frame(message)
            
            await websocket.send_json(result)
            
    except WebSocketDisconnect:
        logger.info(f"Agent WS disconnected: {session_id}")
    except Exception as e:
        logger.error(f"Agent error in {session_id}: {e}")

@app.get("/health")
async def health_check():
    return {"status": "healthy", "agents_active": len(agent_sessions)}

@app.post("/session/evaluate")
async def evaluate_session(req: EvalRequest):
    # Use the Agentic Evaluator
    eval_agent = InterviewEvaluationAgent()
    result = await eval_agent.run({
        "role": req.role,
        "topic": req.topic,
        "messages": req.messages,
        "proctor_logs": req.proctor_logs
    })
    return result

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
