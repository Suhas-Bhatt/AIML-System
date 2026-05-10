# AI Proctoring System — Optimized

A rebuilt version of the original `exam-cheating-detection` project that
addresses the 22 issues identified in the architecture review. Designed
to run on a **low-end laptop** (i3 12th-gen, 8 GB RAM, integrated GPU)
without dropping frames or generating false positives.

See `CHANGES.md` for the issue-by-issue mapping between the review
document and the changes made.

## Highlights

- **One face inference per frame** (was four — biggest single win)
- **Temporal validation**: face missing > 3 s, gaze away > 2 s, etc.
- **State-change events** instead of per-loop spam
- **Bounded event queue** (no more unbounded RAM growth)
- **Head pose via solvePnP** for real gaze tracking
- **Mouth + audio fusion** so chewing/smiling don't trigger
- **Per-type screenshot cooldown** (no I/O thrashing)
- **Incremental session saves** every 30 s — survives crashes
- **Adaptive performance mode** via `psutil` (auto-downshift on overload)
- **Liveness detection** via blink rate (anti-photo-spoof)

## Layout

```
exam-cheating-detection-optimized/
├── config/config.yaml
├── models/yolov8n.pt              ← copy from original project
├── face_landmarker.task           ← copy from original project
├── requirements.txt
├── README.md
├── CHANGES.md
└── src/
    ├── main.py                    ← entry point
    ├── core/
    │   ├── engine.py              ← bounded queue + shared buffers
    │   ├── threads.py             ← thread layout
    │   └── suspicion_validator.py ← temporal validation engine
    ├── detection/
    │   ├── face_pipeline.py       ← THE single MediaPipe inference
    │   ├── head_pose.py           ← solvePnP yaw/pitch/roll
    │   ├── eye_gaze.py            ← EAR + gaze offset
    │   ├── mouth_analyzer.py      ← lip-separation
    │   ├── liveness.py            ← blink-rate liveness
    │   ├── object_detection.py    ← YOLOv8n @ 2 FPS
    │   └── audio_detection.py     ← VAD + persistence
    ├── utils/
    │   ├── violation_logger.py    ← episode-based + incremental save
    │   ├── screenshot_utils.py    ← per-type cooldown
    │   ├── performance_monitor.py ← adaptive mode (psutil)
    │   ├── alert_system.py        ← TTS with cooldown
    │   ├── logging.py
    │   ├── video_utils.py
    │   └── screen_capture.py
    └── reporting/
        ├── report_generator.py
        └── templates/base_report.html
```

## Setup

```bash
# 1. Get model files from the original project (not bundled here, ~10 MB):
#    cp /path/to/original/models/yolov8n.pt        ./models/
#    cp /path/to/original/face_landmarker.task     ./

# 2. Install Python deps
python -m pip install -r requirements.txt

# 3. Run from the project root so config/ and models/ resolve correctly
cd src
python main.py
```

Press **q** in the video window to stop the session and generate the
report. Output:

- `reports/violations.json` — episode-based event log (saved every 30 s)
- `reports/violation_captures/` — annotated evidence screenshots
- `reports/generated/report_*.html` — final report with charts
- `recordings/webcam_*.mp4`, `recordings/screen_*.mp4` — full session video

## Tuning

Open `config/config.yaml`. The most useful knobs:

| What you want                     | Setting                                         |
| --------------------------------- | ----------------------------------------------- |
| Stricter on looking away          | `suspicion.gaze_away_sec` ↓                     |
| More tolerant of brief absence    | `suspicion.face_missing_sec` ↑                  |
| Lower CPU usage                   | drop all `*.fps` values; `video.resolution` to `[480, 360]` |
| Disable adaptive auto-downshift   | `performance.monitor_enabled: false`            |
| Mouth movement alone is enough    | `detection.mouth.require_audio: false`          |
| Fewer evidence screenshots        | `logging.screenshot_cooldown` ↑                 |

## What was removed

- `facenet-pytorch` / MTCNN — replaced by a single MediaPipe pipeline
- `webrtcvad-wheels` — replaced by a lighter energy + ZCR detector with
  persistence-based debouncing
- The legacy `dashboard/app.py` (Flask) — wasn't wired in and added
  nothing the report doesn't already cover

## Known caveats

- `pdfkit` requires `wkhtmltopdf` to be installed system-wide. Without
  it, reports fall back to HTML automatically (set
  `reporting.wkhtmltopdf_path: ""` to skip the check).
- `pygame-ce` and `gTTS` are imported lazily — voice alerts will
  silently no-op if either is missing or the mixer can't init (e.g.
  headless CI).
- The first run downloads MediaPipe / Ultralytics weights only if the
  bundled files are missing.
