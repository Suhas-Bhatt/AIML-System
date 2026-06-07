"""
standalone_test.py — Quick local webcam test for the Sentinel proctoring engine.

This harness drives the ViolationEngine API directly. It builds events in the
exact shape ViolationEngine.process_event() expects:

    { "type": "FACE_DATA",   "detail": { "face_detected": bool, "face_count": int, "face_obscured": bool } }
    { "type": "GAZE_DATA",   "detail": { "gaze_point": (x, y), "gaze_confidence": float } }
    { "type": "OBJECT_EVENT","detail": { "objects": [ { "type": str, "confidence": float } ] } }

process_event() returns a Violation OBJECT (or None). Use .to_dict() to read it.
Summary is read via get_violation_summary() and get_violations().
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

    buffer  = SharedFrameBuffer()
    cam     = CameraThread(buffer)
    engine  = SentinelEngine(buffer)

    # ViolationEngine takes only session_id (per-session isolation).
    violation_engine = ViolationEngine(SESSION_ID)

    current_stats = {"faces": 0, "gaze": "Initializing...", "head_yaw": 0.0, "objects": "Clear"}
    latest_alert = None  # holds a Violation .to_dict() result

    engine.add_worker(FaceWorker,   interval=5)
    engine.add_worker(GazeWorker,   interval=8)
    engine.add_worker(ObjectWorker, interval=25)

    cam.start()
    engine.start()
    print("[*] Sentinel Engine started. Press 'q' to stop.")

    try:
        while True:
            frame, _ = buffer.get_frame()
            if frame is not None:
                display = frame.copy()

                try:
                    while not engine.event_queue.empty():
                        raw = engine.event_queue.get_nowait()
                        etype = raw.get("type")

                        if etype == "FACE_DATA":
                            count = raw.get("count", 0)
                            current_stats["faces"] = count
                            for (x, y, w, h) in raw.get("faces", []):
                                cv2.rectangle(display, (x, y), (x + w, y + h), (0, 255, 0), 2)
                            # Translate worker event -> engine contract
                            event = {"type": "FACE_DATA", "detail": {
                                "face_detected": count >= 1,
                                "face_count": count,
                                "face_obscured": raw.get("obscured", False),
                            }}
                            v = violation_engine.process_event(event)
                            if v: latest_alert = v.to_dict()

                        elif etype == "GAZE_DATA":
                            current_stats["gaze"]     = raw.get("direction", "?")
                            current_stats["head_yaw"] = raw.get("head_yaw", 0.0)
                            event = {"type": "GAZE_DATA", "detail": {
                                "gaze_point": raw.get("gaze_point"),
                                "gaze_confidence": raw.get("gaze_confidence", 0.0),
                            }}
                            v = violation_engine.process_event(event)
                            if v: latest_alert = v.to_dict()

                        elif etype == "OBJECT_EVENT":
                            current_stats["objects"] = raw.get("label", "?")
                            event = {"type": "OBJECT_EVENT", "detail": {
                                "objects": raw.get("objects", []),
                            }}
                            v = violation_engine.process_event(event)
                            if v: latest_alert = v.to_dict()

                except queue.Empty:
                    pass

                overlay = display.copy()
                cv2.rectangle(overlay, (5, 5), (350, 170), (0, 0, 0), -1)
                cv2.addWeighted(overlay, 0.6, display, 0.4, 0, display)
                white, green, red = (255, 255, 255), (0, 255, 0), (0, 0, 255)

                cv2.putText(display, "[ SENTINEL SYSTEM STATUS ]", (10, 25), 0, 0.5, green, 1)
                cv2.putText(display, f"FACE COUNT : {current_stats['faces']}",            (10,  55), 0, 0.5, white, 1)
                cv2.putText(display, f"GAZE DIR   : {current_stats['gaze']}",             (10,  80), 0, 0.5, white, 1)
                cv2.putText(display, f"HEAD YAW   : {current_stats['head_yaw']:.1f} deg", (10, 105), 0, 0.5, white, 1)
                cv2.putText(display, f"OBJECTS    : {current_stats['objects']}",          (10, 130), 0, 0.5, white, 1)

                if latest_alert:
                    # to_dict() emits 'type' and 'details' (not 'detail'/'formatted_time')
                    msg = f"ALERT: {latest_alert['type']} - {latest_alert['severity']}"
                    cv2.putText(display, msg, (10, 155), 0, 0.45, red, 1)

                cv2.imshow("Sentinel - Proctoring Test", display)

            if cv2.waitKey(1) & 0xFF == ord('q'):
                break
            time.sleep(0.033)

    finally:
        print("[*] Shutting down...")
        summary = violation_engine.get_violation_summary()
        print(f"[*] Session violations: {summary['total_violations']}")
        for v in violation_engine.get_violations():
            print(f"    [{v['severity']}] {v['type']} at {v['timestamp']}")
        violation_engine.close()
        cam.stop()
        engine.stop()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    run_test()
