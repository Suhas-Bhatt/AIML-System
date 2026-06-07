from faster_whisper import WhisperModel
import traceback
import logging

# Initialize model once
try:
    # "base" or "tiny" can be used for faster CPU inference
    model = WhisperModel("base", device="cpu", compute_type="int8")
except Exception as e:
    logging.error(f"Failed to load WhisperModel: {e}")
    model = None

def transcribe_audio(file_path: str) -> str:
    if model is None:
        return None
        
    try:
        segments, info = model.transcribe(file_path, beam_size=5)
        text = " ".join([segment.text for segment in segments])
        return text.strip() if text else ""
    except Exception as e:
        logging.error(f"Transcription error: {e}")
        traceback.print_exc()
        return None
