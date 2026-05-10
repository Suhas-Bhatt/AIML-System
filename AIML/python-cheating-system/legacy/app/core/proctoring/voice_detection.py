import sounddevice as sd
import numpy as np
import threading
import time
import speech_recognition as sr
import queue

class VoiceDetector:
    def __init__(self, threshold=0.01, sample_rate=16000):
        self.threshold = threshold
        self.sample_rate = sample_rate
        self.is_running = False
        self.voice_detected = False
        self.last_speech = ""
        self.audio_queue = queue.Queue()
        self.recognizer = sr.Recognizer()
        self.current_amplitude = 0
        
    def _audio_callback(self, indata, frames, time, status):
        """This is called (from a separate thread) for each audio block."""
        if status:
            print(status)
        
        # Calculate RMS amplitude
        amplitude = np.linalg.norm(indata) / np.sqrt(len(indata))
        self.current_amplitude = amplitude
        
        if amplitude > self.threshold:
            self.voice_detected = True
        else:
            self.voice_detected = False

    def start(self):
        self.is_running = True
        try:
            self.stream = sd.InputStream(
                callback=self._audio_callback,
                channels=1,
                samplerate=self.sample_rate
            )
            self.stream.start()
        except Exception as e:
            print(f"Error starting audio stream: {e}")
            self.is_running = False

    def stop(self):
        self.is_running = False
        if hasattr(self, 'stream'):
            self.stream.stop()
            self.stream.close()

    def get_status(self):
        return {
            "is_speaking": self.voice_detected,
            "amplitude": self.current_amplitude,
            "last_speech": self.last_speech
        }

if __name__ == "__main__":
    # Test
    vd = VoiceDetector(threshold=0.02)
    vd.start()
    try:
        while True:
            status = vd.get_status()
            print(f"Speaking: {status['is_speaking']} | Amp: {status['amplitude']:.4f}", end="\r")
            time.sleep(0.1)
    except KeyboardInterrupt:
        vd.stop()
