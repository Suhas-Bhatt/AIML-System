from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import speech, tts

app = FastAPI(title="AIML Voice API", description="Voice services for AIML Interview System")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Allow all origins for development, adjust for prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(speech.router, prefix="/api/speech", tags=["speech"])
app.include_router(tts.router, prefix="/api/tts", tags=["tts"])

@app.get("/health")
async def health_check():
    return {"status": "ok"}
