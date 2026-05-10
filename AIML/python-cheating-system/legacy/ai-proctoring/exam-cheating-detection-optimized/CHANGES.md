# CHANGES — review issues → fixes

This file maps each item from the architecture review to the file(s)
where it was addressed.

## Critical (highest impact)

| # | Issue                              | Fix                                                                      | File(s)                                  |
|---|------------------------------------|--------------------------------------------------------------------------|------------------------------------------|
| 1 | Duplicate frame reads              | `deque(maxlen=1)` shared buffer; consumers read by reference, no `.copy()` | `core/engine.py`                         |
| 2 | Face detection repeated 4×         | Single `FacePipeline` runs MediaPipe once per frame                      | `detection/face_pipeline.py`             |
| 3 | No central face pipeline           | `SharedFaceData` + `FacePipelineThread`; consumers read landmarks        | `core/engine.py`, `core/threads.py`      |
| 4 | Event spam (per-loop emits)        | `SuspicionValidator` emits only on rising/falling edges of confirmed state | `core/suspicion_validator.py`          |
| 5 | Unbounded queue                    | `Queue(maxsize=...)` + `put_nowait` (drop-on-full counter)               | `core/engine.py`                         |
| 6 | `frame.copy()` per loop            | Removed; deque buffer publishes references                               | `core/engine.py`                         |
| 7 | No frame-skipping strategy         | Each thread has its own `target_fps`; sleeps to budget                   | `core/threads.py`, `config.yaml`         |
| 8 | YOLO too heavy                     | YOLOv8n at `imgsz=320`, 2 FPS, `verbose=False`, `iou=0.45`               | `detection/object_detection.py`          |
| 9 | No suspicion confirmation          | Temporal thresholds in `SuspicionValidator` (3 s face, 2 s gaze, 4 s talking) | `core/suspicion_validator.py`         |
| 10 | Mouth detection too noisy         | Mouth + audio fusion: only flag if both active                           | `core/threads.py` → `MouthAnalysisThread`|
| 11 | No head pose                      | `HeadPoseEstimator` via `cv2.solvePnP` (yaw/pitch/roll degrees)          | `detection/head_pose.py`                 |
| 12 | UI thread blocking                | UI runs in main loop only; capture/recording/inference all in threads    | `src/main.py`                            |
| 13 | No adaptive mode                  | `PerformanceMonitor` (psutil) downshifts FPS budgets when CPU/RAM > 85 % | `utils/performance_monitor.py`           |
| 14 | Screenshot I/O too high           | `ViolationCapturer` enforces per-type cooldown (10 s default)            | `utils/screenshot_utils.py`              |
| 15 | Logging too heavy                 | Episode-based logger: one entry per (start → end) span, not per frame    | `utils/violation_logger.py`              |
| 16 | No anti-spoof                     | `LivenessTracker` flags <6 blinks/min                                    | `detection/liveness.py`                  |
| 17 | Report only at shutdown           | `ViolationLogger.save()` called every 30 s (atomic write)                | `utils/violation_logger.py`              |
| 18 | No resource monitoring            | `PerformanceMonitor` exposes `snapshot()`; HUD shows CPU/RAM/mode        | `utils/performance_monitor.py`           |
| 19 | Recommended architecture          | Implemented: see ASCII flow in `src/main.py` docstring                   | `src/main.py`                            |
| 20 | Low-end laptop priorities         | Defaults: 480p capture, 10 FPS face, 2 FPS object, mouth+audio fusion    | `config/config.yaml`                     |
| 21 | Missing professional features     | Added head pose, liveness, episode logging; tab-switch / keyboard / network monitoring still TODO | various                |
| 22 | Final assessment items            | All 10 "biggest weaknesses" addressed above                              | -                                        |

## Architectural diff vs. original

```
                                BEFORE                                                   AFTER
─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
                                                                                          
       Camera                                                                       Camera
         │                                                                            │
         ▼                                                                            ▼
   SharedFrameBuffer (with .copy() on every read)                              SharedFrameBuffer  (deque maxlen=1)
   ┌───────┬───────┬───────┬───────┐                                                  │
   ▼       ▼       ▼       ▼       ▼                                                  │
 Face    Multi   Eye     Mouth   Audio                                          FacePipelineThread (1× MediaPipe)
(MTCNN) (MTCNN) (MP)    (MP)    (sd)                                                  │
   │       │       │       │      │                                              SharedFaceData
   ▼       ▼       ▼       ▼      ▼                                                  │
   queue.Queue (unbounded; spam)                                                ┌─────┼─────┬─────────┐
                                                                                ▼     ▼     ▼         ▼
                                                                              Gaze  Mouth (uses    Object   Audio
                                                                                    audio fusion)  (YOLOv8n) (sd)
                                                                                │     │     │         │
                                                                                └─────┴─────┴─────────┘
                                                                                            │
                                                                                            ▼
                                                                                  SuspicionValidator
                                                                                  (temporal thresholds,
                                                                                  state-change events)
                                                                                            │
                                                                                            ▼
                                                                                queue.Queue (maxsize=100)
```

## Removed dependencies

- `facenet-pytorch` / MTCNN — heavy and only needed because face
  detection was duplicated. Replaced by MediaPipe FaceLandmarker which
  we already needed for landmarks.
- `webrtcvad-wheels` — lightweight energy+ZCR with persistence works
  well enough and avoids the native build dependency.
- `flask` — the empty `dashboard/app.py` was never wired in.

## Things deliberately not done

- **Browser tab switch / keyboard anomaly / clipboard monitoring**
  (review item #21). These need OS-level hooks that don't fit cleanly
  into the existing webcam-centric architecture; flagged for a v2.
- **Whisper transcription**. Kept the config flag but disabled by
  default — it's far too heavy for the i3 target.
- **Identity verification at session start**. Out of scope.
