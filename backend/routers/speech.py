from fastapi import APIRouter, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from services.whisper_service import transcribe_audio
import tempfile
import os
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

@router.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    """
    OPTIMIZATION: Transcribe audio with guaranteed cleanup
    - Cleanup temporary files even if transcription fails
    - Log cleanup status
    """
    if not audio:
        raise HTTPException(status_code=400, detail="Missing audio file")
    
    temp_file_path = None
    try:
        # Create temp file with explicit cleanup
        with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as temp_file:
            content = await audio.read()
            temp_file.write(content)
            temp_file_path = temp_file.name

        logger.debug(f"Created temp audio file: {temp_file_path}")
        
        # Perform transcription
        text = transcribe_audio(temp_file_path)
        
        if text is None:
            logger.warning(f"Transcription failed for {temp_file_path}")
            return JSONResponse(
                status_code=500,
                content={"success": False, "message": "Transcription failed"}
            )

        logger.info(f"Transcription succeeded: {len(text)} characters")
        return {"success": True, "text": text or ""}
    
    except Exception as e:
        logger.error(f"Audio transcription error: {e}")
        return JSONResponse(
            status_code=500,
            content={"success": False, "message": str(e)}
        )
    
    finally:
        # OPTIMIZATION: Guarantee cleanup even on exception
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
                logger.debug(f"Cleaned up temp file: {temp_file_path}")
            except Exception as e:
                logger.error(f"Failed to cleanup temp file {temp_file_path}: {e}")

