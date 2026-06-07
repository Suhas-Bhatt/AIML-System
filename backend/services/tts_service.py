import edge_tts
import io
import logging

VOICE = "en-US-AriaNeural"

async def generate_speech(text: str) -> bytes:
    try:
        communicate = edge_tts.Communicate(text, VOICE)
        audio_stream = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_stream.write(chunk["data"])
        return audio_stream.getvalue()
    except Exception as e:
        logging.error(f"TTS generation error: {e}")
        return None
