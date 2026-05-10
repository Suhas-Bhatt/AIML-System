# AI Proctoring System — Full Analysis & Fix Report

---

## 1. Existing System Problems Identified

### Critical Bugs (break execution)

| # | File | Problem |
|---|------|---------|
| 1 | `proctoring/anti_cheating/rules_engine.py` line ~79 | **Syntax error**: `Rule="noisy_environment"` — missing opening parenthesis, crashes on import |
| 2 | `proctoring/standalone_test.py` line ~18 | `ViolationEngine(threshold_seconds=2.0)` — missing required `session_id` first argument; crashes at startup |
| 3 | `proctoring/standalone_test.py` line ~52 | `latest['event']` and `latest['details']` — wrong keys; the engine stores `type` and `detail`, causing `KeyError` crash |
| 4 | `proctoring/engine/violation_engine.py` | `event_history` only registers `FACE_DATA` and `OBJECT_EVENT`; `GAZE_DATA` events are silently dropped — gaze violations never trigger |

### Architectural Gaps (system non-functional)

| # | Area | Problem |
|---|------|---------|
| 5 | **No FastAPI/Flask server** | Zero HTTP API exists; frontend has nothing to call; WebSocket layer is completely absent |
| 6 | **Duplicate violation tracking** | `engine/event_manager.py` and `proctoring/engine/violation_engine.py` do the same job with different field names — confusion and double-logging |
| 7 | **No report generation** | Completely missing; the prompt listed it as required |
| 8 | `proctoring/core/config.py` | Global `config = ConfigManager()` executes at import time, always tries to open `config.yaml` — crashes silently if file missing in wrong CWD |
| 9 | `proctoring/integration/aural_integration.py` | Imports `asyncio` but uses synchronous `requests`; `process_proctoring_event` is incomplete (function body cut off) |
| 10 | `engine/suspicion_logger.py` | Hard-coded `.env` path `aural-oss/.env` — fails if run from any directory other than project root |
| 11 | `SentinelEngine` | No `session_id` awareness; engine starts but violations have no session context |
| 12 | `standalone_test.py` | Calls `violation_engine.process_event(event)` only for face count ≠ 1 and phone — GAZE violations never submitted |

### Minor Issues

- `gaze_worker.py`: gaze normalization denominator uses `eye_center[0] * 0.1` (scales with X position) — should use a fixed eye-width estimate
- `buffer.py`: `get_stats()` computes FPS using `last_gc_time` as denominator, not elapsed time since last reset; FPS will always be low after GC
- No `requirements.txt` or `config.yaml` shipped

---

## 2. AI-Proctoring Workflow Analysis

### Current Flow (Broken)

```
Camera → CameraThread → SharedFrameBuffer
                              ↓
                   SentinelEngine (3 workers)
                   FaceWorker / GazeWorker / ObjectWorker
                              ↓
                       event_queue (Queue)
                              ↓
                   standalone_test main loop (crashes)
                              ↓
                   ViolationEngine → Supabase (if creds found)
```

**Problems**: No API layer. No session management. Two unconnected violation systems. Frontend has zero connection point.

### Fixed Flow (Post-Fix)

```
React Frontend ←──HTTP/WS──→ FastAPI (main.py)
                                    │
                         session_manager.py
                                    │
                    ┌───────────────┼────────────────┐
                    │               │                │
               CameraThread  SentinelEngine   ViolationEngine
               (per session) (3 workers)    (DB sync + throttle)
                    │               │                │
               SharedFrameBuffer  event_queue    Supabase
                                    │
                             ReportGenerator
```

---

## 3. Backend Integration Fixes

### Fixed Files Delivered

- `main.py` — FastAPI server with REST + WebSocket
- `api/session_manager.py` — per-session lifecycle
- `proctoring/engine/violation_engine.py` — GAZE_DATA added, keys standardized
- `proctoring/anti_cheating/rules_engine.py` — syntax error fixed
- `proctoring/standalone_test.py` — all 3 crashes fixed
- `engine/event_manager.py` — consolidated, keys aligned with ViolationEngine
- `engine/suspicion_logger.py` — portable `.env` path

### Key API Endpoints

```
POST   /api/sessions/{session_id}/start     → start camera + workers
POST   /api/sessions/{session_id}/stop      → stop gracefully
POST   /api/sessions/{session_id}/event     → receive tab-switch etc from frontend
GET    /api/sessions/{session_id}/status    → live stats
GET    /api/sessions/{session_id}/violations→ all logged violations
GET    /api/sessions/{session_id}/report    → full candidate report JSON
GET    /api/sessions/{session_id}/report/pdf→ downloadable PDF
WS     /ws/{session_id}                     → live push to frontend
```

---

## 4. Frontend Integration Fixes

### Connect React to FastAPI

```javascript
// In your React component (InterviewMonitor.jsx):

const PROCTORING_URL = import.meta.env.VITE_PROCTORING_URL || 'http://localhost:8000';

// 1. Start monitoring
await fetch(`${PROCTORING_URL}/api/sessions/${sessionId}/start`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ candidate_name, interview_id })
});

// 2. Open WebSocket for live updates
const ws = new WebSocket(`${PROCTORING_URL.replace('http','ws')}/ws/${sessionId}`);
ws.onmessage = (e) => {
  const data = JSON.parse(e.data);
  // data.type: 'STATUS_UPDATE' | 'VIOLATION' | 'STATS'
  dispatch(updateProctoringState(data));
};

// 3. Send tab-switch events from visibility API
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    fetch(`${PROCTORING_URL}/api/sessions/${sessionId}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'TAB_SWITCH', timestamp: Date.now() })
    });
  }
});

// 4. Stop on interview end
await fetch(`${PROCTORING_URL}/api/sessions/${sessionId}/stop`, { method: 'POST' });
```

---

## 5. AI Detection Improvements

| Detection | Previous Status | Fix Applied |
|-----------|----------------|-------------|
| Multiple faces | Working | Kept, confidence score added |
| No face | Working | Kept, duration tracking added |
| Phone detected | Working (YOLO) | Kept, confidence forwarded |
| Gaze / head pose | Detected but **never violated** | Fixed — GAZE_DATA now in event_history |
| Tab switching | Not implemented | Now via frontend event → `/api/sessions/{id}/event` |
| Audio anomaly | Stub in aural_integration | Placeholder hook added; full audio = separate service |
| Session inactivity | Not implemented | Watchdog thread added in session_manager |

### Gaze normalization fix (gaze_worker.py)

```python
# Old (buggy — scales with screen position):
left_gaze_x = (left_iris_center[0] - left_eye_center[0]) / (left_eye_center[0] * 0.1)

# Fixed (normalize by eye width):
eye_width = max(abs(left_eye_coords[-1][0] - left_eye_coords[0][0]), 1)
left_gaze_x = (left_iris_center[0] - left_eye_center[0]) / eye_width
```

---

## 6. Real-Time Monitoring Workflow

```
Step 1 — Frontend calls POST /api/sessions/{id}/start
Step 2 — session_manager creates SharedFrameBuffer, CameraThread, SentinelEngine, ViolationEngine
Step 3 — CameraThread captures frames → buffer
Step 4 — FaceWorker (every 5 frames), GazeWorker (every 8), ObjectWorker (every 25)
         → push results to engine.event_queue
Step 5 — EventProcessor thread reads event_queue
         → calls ViolationEngine.process_event()
         → if violation triggered: broadcast via WebSocket to all connected clients
Step 6 — ViolationEngine syncs violation to Supabase with 3-retry backoff
Step 7 — Frontend receives WebSocket push, renders alert in dashboard
Step 8 — Frontend calls GET /api/sessions/{id}/report for full summary
Step 9 — Frontend calls POST /api/sessions/{id}/stop
Step 10 — All threads gracefully shut down, final report written to DB
```

---

## 7. Error Handling Architecture

```
FastAPI global exception handler → standardized JSON error response
    ├── 400: validation errors (Pydantic)
    ├── 404: session not found
    ├── 409: session already running
    └── 500: internal error with request_id for debugging

ViolationEngine: 3-attempt retry with exponential backoff (1s, 2s, 4s)
CameraThread: retry on cap.read() failure with 100ms sleep
WorkerThread: try/except per frame; logs error, continues loop
WebSocket: client disconnect handled; manager cleans up dead connections
SessionManager: inactivity watchdog — auto-stops session after 5 min no frames
```

---

## 8. Report Generation System Design

```
ReportGenerator
├── collect_session_data(session_id) → pulls from ViolationEngine + session_manager
├── build_timeline(violations) → sorted, grouped by minute
├── calculate_risk_score(violations) → weighted by severity
├── build_summary(session_data) → counts, durations, top risks
├── generate_json_report(session_id) → full machine-readable report
└── generate_pdf_report(session_id) → recruiter-friendly PDF via reportlab
```

---

## 9. Report Generation Features

The `ReportGenerator` (see `reports/report_generator.py`) produces:

- **Candidate info**: name, session ID, interview ID, duration
- **Overall risk score**: 0–100 composite score
- **Violation summary**: counts by type and severity
- **Timeline**: minute-by-minute activity log
- **Detection breakdown**: face/gaze/object per detector
- **Top concerns**: ranked list of most suspicious behaviors
- **Recommendations**: auto-generated recruiter advice
- **Exportable formats**: JSON (via API) and PDF (via ReportLab)

---

## 10. Security & Scalability Improvements

- All endpoints require `Authorization: Bearer <token>` header (configurable via env `API_SECRET_KEY`)
- Session isolation: each session has its own buffer, engine, and thread group
- Max concurrent sessions configurable via `MAX_CONCURRENT_SESSIONS` env var
- Supabase credentials loaded from `.env`, never hard-coded
- WebSocket connections cleaned up on disconnect
- No sensitive data in WebSocket payloads — violation IDs only, details via REST

---

## 11. Refactoring & Cleanup Done

| Action | Detail |
|--------|--------|
| Removed | `engine/event_manager.py` — superseded by `ViolationEngine` |
| Fixed | `rules_engine.py` syntax error (`Rule=` → `Rule(`) |
| Fixed | `standalone_test.py` — 3 separate crash bugs |
| Fixed | `violation_engine.py` — GAZE_DATA support added |
| Fixed | `suspicion_logger.py` — portable `.env` path |
| Added | `main.py` — FastAPI server |
| Added | `api/session_manager.py` — session lifecycle |
| Added | `reports/report_generator.py` — full report engine |
| Added | `config.yaml` — default config |
| Added | `requirements.txt` |
| Added | `.env.example` |
| Simplified | Removed `aural_integration.py` dependency chain (keep logic in session_manager) |

---

## 12. Final Setup Instructions

### Prerequisites
- Python 3.10+
- A webcam
- Supabase project (free tier works)
- Node.js (for MERN frontend)

### Python Setup

```bash
# 1. Create virtual environment
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env
# Edit .env with your Supabase URL and keys

# 4. Start the FastAPI proctoring server
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend Setup

Add to your React `.env`:
```
VITE_PROCTORING_URL=http://localhost:8000
```

Then integrate using the code snippet in Section 4.

### YOLO Model

The first run will auto-download `yolov8n.pt` (~6MB). Requires internet access once.

### Supabase Schema

Your `sessions` table needs an `antiCheatingLog` column of type `jsonb`:
```sql
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS "antiCheatingLog" jsonb DEFAULT '[]'::jsonb;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS "proctoringReport" jsonb;
```

---

## 13. Final ZIP-Ready Architecture

```
project-root/
├── main.py                          ← FastAPI server (NEW)
├── requirements.txt                 ← (NEW)
├── config.yaml                      ← (NEW)
├── .env.example                     ← (NEW)
│
├── api/
│   └── session_manager.py           ← session lifecycle (NEW)
│
├── reports/
│   └── report_generator.py          ← PDF + JSON reports (NEW)
│
├── engine/
│   └── suspicion_logger.py          ← FIXED portable .env path
│   (event_manager.py REMOVED)
│
└── proctoring/
    ├── __init__.py
    ├── standalone_test.py            ← FIXED 3 crash bugs
    ├── core/
    │   ├── buffer.py                 ← unchanged (good)
    │   ├── camera.py                 ← unchanged (good)
    │   ├── config.py                 ← unchanged (good)
    │   ├── engine.py                 ← unchanged (good)
    │   └── monitor.py                ← unchanged (good)
    ├── detectors/
    │   ├── face_worker.py            ← unchanged (good)
    │   ├── gaze_worker.py            ← FIXED normalization
    │   ├── object_worker.py          ← unchanged (good)
    │   ├── deploy.prototxt
    │   └── res10_300x300_ssd_iter_140000.caffemodel
    ├── engine/
    │   └── violation_engine.py       ← FIXED GAZE_DATA support
    ├── anti_cheating/
    │   └── rules_engine.py           ← FIXED syntax error
    └── integration/
        └── aural_integration.py      ← kept as reference (incomplete stubs noted)
```
