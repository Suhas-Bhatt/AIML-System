# AIML Interview System - Production Monorepo

Welcome to the unified, production-grade **AIML Interview System**. This project is structured as a multi-service monorepo, integrating Next.js, FastAPI voice services, and AI proctoring modules into a single repository layout.

---

## 📂 Project Structure

```
├── .github/                 # GitHub workflows & issue/PR templates
│   ├── workflows/ci.yml     # Automated lint, build, & syntax CI
│   ├── ISSUE_TEMPLATE/      # Standard bug/feature issue designs
│   └── PULL_REQUEST_TEMPLATE.md
├── docs/
│   └── architecture.md      # Detailed system architecture guide
├── frontend/                # Next.js web client & dashboard
│   ├── package.json
│   └── src/                 # Contains onboarding, voice, & proctored interview pages
├── backend/                 # Python FastAPI Voice Service (STT/TTS)
│   ├── app.py               # Router entrypoint (Port 8001)
│   └── requirements.txt
├── python-cheating-system/  # Python FastAPI AI Proctoring Server (Port 8000)
│   ├── main.py              # Main websocket & event handler
│   └── run.py               # Configured runner script
├── supabase/                # Supabase database config & SQL migrations
└── README.md                # Root documentation
```

For a detailed view of the system architecture and interaction flow, see the [Architecture Guide](docs/architecture.md).

---

## ⚙️ Setup & Configuration

Each service operates with its own environment config. Duplicate the environment examples and populate them:

### 1. Database (Supabase)
Ensure you have a Supabase project set up. Apply the migration scripts located in `/supabase/migrations` to your database schema.

### 2. Environment Variables

Create `.env` files in their respective folders:

* **Frontend (`/frontend/.env`)**:
  ```ini
  NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
  SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
  DATABASE_URL=postgresql://postgres:password@db.your-project.supabase.co:5432/postgres
  NEXT_PUBLIC_APP_URL=http://localhost:3000
  OPENAI_API_KEY=sk-proj-xxxxxx
  GOOGLE_API_KEY=AIzaSyxxxxxx
  NEXT_PUBLIC_ENABLE_VOICE=true
  NEXT_PUBLIC_VOICE_API_URL=http://localhost:8001
  NEXT_PUBLIC_PROCTORING_WS_URL=ws://localhost:8000
  ```

* **Voice Backend (`/backend/.env`)**:
  ```ini
  NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
  SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
  DATABASE_URL=postgresql://postgres:password@db.your-project.supabase.co:5432/postgres
  OPENAI_API_KEY=sk-proj-xxxxxx
  GOOGLE_API_KEY=AIzaSyxxxxxx
  ```

* **Proctoring Server (`/python-cheating-system/.env`)**:
  ```ini
  SUPABASE_URL=https://your-project.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
  API_SECRET_KEY=your-secret-api-key
  ALLOWED_ORIGINS=http://localhost:3000
  MAX_CONCURRENT_SESSIONS=10
  DEFAULT_CAMERA_INDEX=0
  ```

---

## 🚀 Running the Platform

Run each service in separate terminal windows:

1. **Supabase Local (Optional)**:
   ```bash
   cd supabase
   # (If using local supabase CLI)
   supabase start
   ```

2. **FastAPI Voice Backend** (Starts on port `8001`):
   ```bash
   cd backend
   pip install -r requirements.txt
   uvicorn app:app --host 0.0.0.0 --port 8001 --reload
   ```

3. **FastAPI Proctoring Backend** (Starts on port `8000`):
   ```bash
   cd python-cheating-system
   pip install -r requirements.txt
   python run.py
   ```

4. **Next.js Frontend** (Starts on port `3000`):
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

---

## 🧪 Testing

Run frontend unit and integration tests:

```bash
cd frontend
npm run test:web
```
