from fastapi import APIRouter, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from services.whisper_service import transcribe_audio
import tempfile
import os

router = APIRouter()

@router.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    if not audio:
        raise HTTPException(status_code=400, detail="Missing audio file")
    
    try:
        # Save to temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as temp_file:
            content = await audio.read()
            temp_file.write(content)
            temp_file_path = temp_file.name

        text = transcribe_audio(temp_file_path)
        
        # Cleanup
        os.remove(temp_file_path)
        
        if text is None:
            return JSONResponse(
                status_code=500,
                content={"success": False, "message": "Transcription failed"}
            )
            
        return {"success": True, "text": text}
    
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"success": False, "message": str(e)}
        )
