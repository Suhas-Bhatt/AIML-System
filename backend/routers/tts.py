from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel
from services.tts_service import generate_speech
import traceback

router = APIRouter()

class TTSRequest(BaseModel):
    text: str

@router.post("/speak")
async def speak(request: TTSRequest):
    if not request.text:
        raise HTTPException(status_code=400, detail="Text is required")
        
    try:
        audio_content = await generate_speech(request.text)
        
        if not audio_content:
            return JSONResponse(
                status_code=503,
                content={"success": False, "message": "Voice service unavailable"}
            )
            
        return Response(content=audio_content, media_type="audio/mp3")
        
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=503,
            content={"success": False, "message": "Voice service unavailable"}
        )
