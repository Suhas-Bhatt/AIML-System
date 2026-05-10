# Aural Enterprise: Autonomous AI Proctoring & Interview Platform

A production-grade, agentic platform for conducting and proctoring technical interviews using multi-modal AI agents.

## 🏛️ Architecture

- **Frontend**: Next.js 14+ (App Router, tRPC, Tailwind, Framer Motion)
- **Backend**: Node.js & Supabase (PostgreSQL, Auth, Storage)
- **AI Service**: FastAPI (Python 3.10+)
- **AI Models**: 
  - Vision: YOLOv8 (Objects), MediaPipe (3D Head Pose, EAR Gaze, Liveness)
  - Audio: Heuristic Energy/ZCR Voice Activity Detection
  - Evaluation: Google Gemini 1.5 Flash (Integrity Auditing)

## 🚀 Key Features

- **Autonomous Proctor Agent**: Real-time multi-modal monitoring with temporal suspicion scoring.
- **Enterprise Orchestrator**: Centralized agentic brain managing session state and violation escalation.
- **Identity Matching**: Face recognition and liveness detection to prevent spoofing.
- **Adaptive Interviewing**: Dynamic difficulty adjustment based on candidate performance.
- **Integrity Auditor**: Post-interview investigator that cross-references technical transcripts with proctoring logs.

## 🛠️ Setup & Installation

### 1. Database (Supabase)
Run the following SQL in your Supabase Editor to support AI logs:
```sql
ALTER TABLE sessions 
ADD COLUMN IF NOT EXISTS "antiCheatingLog" jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS "score" numeric;
```

### 2. AI Service (Python)
```bash
cd ai-proctoring
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

### 3. Application (Next.js)
```bash
cd aural-oss
npm install
npm run dev
```

## 🐳 Docker Deployment
```bash
docker-compose up --build
```

## 📄 License
Enterprise Proprietary - Aural AI.
