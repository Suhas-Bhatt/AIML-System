# AIML Interview System - Consolidated Monorepo

Welcome to the unified **AIML Interview System**. This project has been restructured for better maintainability, scalability, and clarity.

## Project Structure

- **`/frontend`**: The primary user interface built with Next.js and React. Includes AI proctoring management, voice interfaces, and interview flows.
- **`/backend`**: Node.js based voice relay services. Handles real-time communication between the browser and AI services (OpenAI/Azure).
- **`/python-cheating-system`**: Python-based AI services for cheating detection (proctoring) and interview evaluation.
- **`/proctoring-server`**: Production-ready, optimized proctoring server with all fixes applied.
- **`/supabase`**: Database migrations and configuration.
- **`/infra`**: Deployment configurations and scripts.
- **`/tests`**: Comprehensive test suites for various components.

## Getting Started

### 1. Environment Configuration
Copy the `.env.example` files in each service directory and populate them with your credentials.
- `frontend/.env`
- `backend/.env`
- `python-cheating-system/.env`
- `proctoring-server/.env`

### 2. Frontend
```bash
cd frontend
npm install
npm run dev
```

### 3. Backend (Voice Relay)
```bash
cd backend
npm install
npm run dev:voice # for Volcengine
# OR
npm run dev:openai-voice # for OpenAI/Azure
```

### 4. Python AI Service (Development)
```bash
cd python-cheating-system
pip install -r requirements.txt
python run.py
```

### 5. Proctoring Server (Production)
```bash
cd proctoring-server
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

## Legacy Documentation
See `README_OLD.md` and `README_PLATFORM.md` for historical context and original instructions.
