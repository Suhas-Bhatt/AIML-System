"""
standalone_test.py — Quick local webcam test for the Sentinel proctoring engine.

Bugs fixed:
  1. ViolationEngine(threshold_seconds=2.0)
     → ViolationEngine("local-test", threshold_seconds=2.0)
     (session_id was missing — TypeError on construction)

  2. latest['event'] and latest['details']
     → latest['type'] and latest['detail']
     (wrong dict keys — KeyError crash)

  3. violation_engine.process_event only called for face count ≠ 1 and phone.
     Gaze violations are now also submitted.
"""

import cv2
import time
import queue
import logging

from proctoring.core.buffer   import SharedFrameBuffer
from proctoring.core.camera   import CameraThread
from proctoring.core.engine   import SentinelEngine
from proctoring.detectors.face_worker   import FaceWorker
from proctoring.detectors.gaze_worker   import GazeWorker
from proctoring.detectors.object_worker import ObjectWorker
from proctoring.engine.violation_engine import ViolationEngine

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


def run_test():
    SESSION_ID = "local-test-session"

    # 1. Initialise core components
    buffer  = SharedFrameBuffer()
    cam     = CameraThread(buffer)
    engine  = SentinelEngine(buffer)

    # BUG FIX 1: session_id is required as first positional argument
    violation_engine = ViolationEngine(SESSION_ID, threshold_seconds=2.0)

    # Live display state
    current_stats = {
        "faces":    0,
        "gaze":     "Initializing...",
        "head_yaw": 0.0,
        "objects":  "Clear",
    }
    latest_alert = None

    # 2. Register workers (intervals = every N frames)
    engine.add_worker(FaceWorker,   interval=5)
    engine.add_worker(GazeWorker,   interval=8)
    engine.add_worker(ObjectWorker, interval=25)

    # 3. Start threads
    cam.start()
    engine.start()

    print("[*] Sentinel Engine started. Press 'q' to stop.")

    try:
        while True:
            frame, _ = buffer.get_frame()
            if frame is not None:
                display = frame.copy()

                # Drain event queue
                try:
                    while not engine.event_queue.empty():
                        event = engine.event_queue.get_nowait()

                        if event["type"] == "FACE_DATA":
                            current_stats["faces"] = event["count"]
                            for (x, y, w, h) in event.get("faces", []):
                                cv2.rectangle(display, (x, y), (x + w, y + h), (0, 255, 0), 2)
                            # Submit ALL face events (count == 0 OR > 1 are bad states)
                            violation = violation_engine.process_event(event)
                            if violation:
                                latest_alert = violation

                        elif event["type"] == "GAZE_DATA":
                            current_stats["gaze"]     = event.get("direction", "?")
                            current_stats["head_yaw"] = event.get("head_yaw", 0.0)
                            # Submit gaze events so looking-away violations fire
                            violation = violation_engine.process_event(event)
                            if violation:
                                latest_alert = violation

                        elif event["type"] == "OBJECT_EVENT":
                            current_stats["objects"] = event.get("label", "?")
                            violation = violation_engine.process_event(event)
                            if violation:
                                latest_alert = violation

                except queue.Empty:
                    pass

                # ── HUD overlay ──────────────────────────────────────
                overlay = display.copy()
                cv2.rectangle(overlay, (5, 5), (350, 170), (0, 0, 0), -1)
                cv2.addWeighted(overlay, 0.6, display, 0.4, 0, display)

                white  = (255, 255, 255)
                green  = (0, 255, 0)
                red    = (0, 0, 255)
                yellow = (0, 220, 220)

                cv2.putText(display, "[ SENTINEL SYSTEM STATUS ]", (10, 25), 0, 0.5, green,  1)
                cv2.putText(display, f"FACE COUNT : {current_stats['faces']}",            (10,  55), 0, 0.5, white, 1)
                cv2.putText(display, f"GAZE DIR   : {current_stats['gaze']}",             (10,  80), 0, 0.5, white, 1)
                cv2.putText(display, f"HEAD YAW   : {current_stats['head_yaw']:.1f} deg", (10, 105), 0, 0.5, white, 1)
                cv2.putText(display, f"OBJECTS    : {current_stats['objects']}",          (10, 130), 0, 0.5, white, 1)

                if latest_alert:
                    # BUG FIX 2: correct keys are 'type' and 'detail' (not 'event'/'details')
                    msg = f"ALERT: {latest_alert['type']} — {latest_alert['detail']}"
                    cv2.putText(display, msg, (10, 155), 0, 0.45, red, 1)

                cv2.imshow("Sentinel — Proctoring Test", display)

            if cv2.waitKey(1) & 0xFF == ord('q'):
                break

            time.sleep(0.033)   # ~30 FPS display cap

    finally:
        print("[*] Shutting down...")
        stats = violation_engine.get_stats()
        print(f"[*] Session violations: {stats['total_violations']}")
        for v in violation_engine.get_violations():
            print(f"    [{v['severity']}] {v['type']} at {v['formatted_time']} — {v['detail']}")

        cam.stop()
        engine.stop()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    run_test()
