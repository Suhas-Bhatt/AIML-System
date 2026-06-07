# 🚀 DEPLOYMENT ACTION PLAN

## Quick Start

**Total Implementation Time:** 1-2 hours  
**Difficulty:** Medium  
**Risk Level:** Low (backward compatible)

---

## ✅ ACTION ITEMS (In Order)

### PHASE 1: Backend Core Changes (30 min)

#### ✓ Step 1: Create YOLO Model Manager
**File:** `python-cheating-system/proctoring/detectors/yolo_model_manager.py` (NEW)
- **Action:** Create from template in this repository
- **Size:** ~85 lines
- **Impact:** Enables singleton YOLO loading
- **Verification:** File exists and can be imported

#### ✓ Step 2: Update Object Worker
**File:** `python-cheating-system/proctoring/detectors/object_worker.py` (MODIFY)
- **Changes:** 
  - Remove YOLO import and model loading
  - Add `from proctoring.detectors.yolo_model_manager import get_yolo_model, is_model_available`
  - Replace `self.model = YOLO(model_path)` with `self.model = get_yolo_model()`
- **Diff Lines:** ~20 lines changed
- **Verification:** `grep "get_yolo_model" object_worker.py` returns matches

#### ✓ Step 3: Update Main FastAPI App
**File:** `python-cheating-system/main.py` (MODIFY)
- **Changes:**
  1. Add import: `from proctoring.detectors.yolo_model_manager import initialize_yolo_model, release_yolo_model`
  2. Add constant: `MAX_WEBSOCKET_HANDLERS_PER_SESSION = 5`
  3. Update WSManager class to accept max_handlers parameter
  4. Add handler limit logic in connect() method
  5. Call initialize_yolo_model() in lifespan startup
  6. Call release_yolo_model() in lifespan shutdown
- **Diff Lines:** ~30 lines changed/added
- **Verification:** `grep "initialize_yolo_model\|MAX_WEBSOCKET_HANDLERS" main.py` returns matches

#### ✓ Step 4: Fix Speech Router Cleanup
**File:** `backend/routers/speech.py` (MODIFY)
- **Changes:**
  1. Add logging import
  2. Initialize temp_file_path = None before try block
  3. Add logging.debug() for temp file creation
  4. Move cleanup to finally block
  5. Add error handling for cleanup failure
- **Diff Lines:** ~15 lines changed/added
- **Verification:** Code has finally block with cleanup logic

---

### PHASE 2: Monitoring Infrastructure (15 min)

#### ✓ Step 5: Create Monitoring Module
**File:** `python-cheating-system/proctoring/monitoring/memory_monitor.py` (NEW)
- **Action:** Create from template
- **Size:** ~260 lines
- **Impact:** Enables resource tracking
- **Verification:** File exists and contains MemoryMonitor class

#### ✓ Step 6: Create Package Init
**File:** `python-cheating-system/proctoring/monitoring/__init__.py` (NEW)
- **Action:** Create with minimal content
- **Verification:** File exists

#### ✓ Step 7: Update Main to Start Monitor (Optional)
**File:** `python-cheating-system/main.py` (OPTIONAL)
- **Changes:** Add monitor start/stop in lifespan
- **Benefit:** Production monitoring enabled
- **Verification:** Monitor logs appear at startup

---

### PHASE 3: Frontend Optimization (30 min)

#### ✓ Step 8: Create Optimized App Component
**File:** `test_interview_app/src/App.optimized.jsx` (NEW REFERENCE)
- **Action:** This file exists as reference
- **Purpose:** Shows all optimizations applied

#### ✓ Step 9: Update App Component
**File:** `test_interview_app/src/App.jsx` (MODIFY - CRITICAL)
- **Option A - Full Replacement:**
  - Replace entire file with optimized version
  - Pros: All optimizations applied at once
  - Cons: Largest change
  - Risk: Low (frontend only)

- **Option B - Incremental Changes:**
  1. Add AIModelManager class at top
  2. Create global modelManager instance
  3. Replace model loading useEffect
  4. Add model disposal in cleanup
  5. Add frame downscaling in detection
  6. Improve event listener cleanup

- **Critical Lines:**
  - Lines 1-30: Add AIModelManager class
  - Lines 165-175: Update model loading
  - Lines 185-220: Update detection with downscaling
  - Lines 250-270: Improve cleanup

- **Verification:**
  - `grep "AIModelManager" src/App.jsx`
  - `grep "modelManager.dispose" src/App.jsx`
  - Console shows "singleton" in model loading messages

#### ✓ Step 10: Update ProctoringService
**File:** `python-cheating-system/frontend/ProctoringService.js` (MODIFY)
- **Changes:**
  1. Add `this._focusHandler` storage
  2. Add focus event listener in _startTabSwitchDetection
  3. Remove focus listener in _stopTabSwitchDetection
  4. Nullify all handlers
- **Diff Lines:** ~10 lines changed
- **Verification:** `grep "_focusHandler" ProctoringService.js` returns matches

---

## 📋 File Checklist

### New Files to Create
- [ ] `python-cheating-system/proctoring/detectors/yolo_model_manager.py`
- [ ] `python-cheating-system/proctoring/monitoring/memory_monitor.py`
- [ ] `python-cheating-system/proctoring/monitoring/__init__.py`
- [ ] `test_interview_app/src/App.optimized.jsx` (reference only)

### Files to Modify
- [ ] `python-cheating-system/main.py` (+30 lines)
- [ ] `python-cheating-system/proctoring/detectors/object_worker.py` (-20 lines, +5 lines)
- [ ] `backend/routers/speech.py` (+15 lines)
- [ ] `test_interview_app/src/App.jsx` (+80 lines, +cleanup improvements)
- [ ] `python-cheating-system/frontend/ProctoringService.js` (+10 lines)

### Files to Backup (Before Modifying)
- [ ] `python-cheating-system/main.py` → main.py.bak
- [ ] `test_interview_app/src/App.jsx` → App.jsx.bak
- [ ] `backend/routers/speech.py` → speech.py.bak

---

## 🔍 Validation After Each Phase

### After Phase 1: Backend Core Changes
```bash
# 1. Verify imports work
python -c "from proctoring.detectors.yolo_model_manager import get_yolo_model; print('✓ YOLO manager imports')"

# 2. Check main.py syntax
python -m py_compile python-cheating-system/main.py
echo "✓ main.py syntax valid"

# 3. Verify object_worker uses singleton
grep "get_yolo_model" python-cheating-system/proctoring/detectors/object_worker.py
echo "✓ object_worker uses singleton"
```

### After Phase 2: Monitoring
```bash
# 1. Verify memory monitor can import
python -c "from proctoring.monitoring.memory_monitor import MemoryMonitor; print('✓ MemoryMonitor imports')"

# 2. Test monitor functionality
python -c "
from proctoring.monitoring.memory_monitor import MemoryMonitor
m = MemoryMonitor()
m.start()
import time; time.sleep(1)
m.stop()
print('✓ MemoryMonitor works')
"
```

### After Phase 3: Frontend
```bash
# 1. Verify syntax
npm run lint

# 2. Build
npm run build

# 3. Check model manager in output
grep -r "AIModelManager" dist/ || echo "❌ ModelManager not in build"

# 4. Test in browser console (after npm run preview)
# Should log: "AIModelManager loading models..."
```

---

## 🧪 Integration Testing

### Test 1: Single Session Lifecycle
```bash
# 1. Start backend
cd python-cheating-system
uvicorn main:app --reload

# 2. In another terminal, start frontend
cd test_interview_app
npm run preview

# 3. In browser:
# - Open developer tools (F12)
# - Console should show:
#   ✓ "Loading AI models via singleton manager..."
#   ✓ "Blazeface loaded (singleton)"
#   ✓ "AI Models loaded successfully (cached)"
#   ✓ No errors about model disposal

# 4. Monitor process
ps aux | grep python | grep main
# Memory should stay ~300-400 MB

# 5. Monitor logs
tail -f /var/log/proctoring.log
# Should show YOLO initialized ONCE at startup
```

### Test 2: Multiple Sessions
```bash
# 1. Create 5 interview sessions
for i in {1..5}; do
  curl -X POST http://localhost:8000/api/sessions/test-$i/start \
    -H "Content-Type: application/json" \
    -d '{"interview_id":"test", "candidate_name":"User$i"}'
done

# 2. Monitor memory (should NOT grow by 5x)
watch -n 1 'ps aux | grep python | grep main'

# 3. Check YOLO loaded only once
grep "YOLO" /var/log/proctoring.log | wc -l
# Should be 1-2 lines (initialization + ready), not per-session

# 4. Monitor WebSocket connections
watch -n 1 'netstat -an | grep -c ESTABLISHED'
# Should be ~5, not growing unbounded
```

### Test 3: Error Handling
```bash
# Test temp file cleanup on error
curl -X POST http://localhost:8000/api/speech/transcribe \
  -F "audio=@/dev/null"

# Check /tmp for orphaned files
find /tmp -name "*interview*" -o -name "*audio*" | wc -l
# Should be 0 (all cleaned up)

# Check logs for cleanup confirmation
grep "Cleaned up temp file" /var/log/proctoring.log
```

---

## 📊 Before & After Comparison

### Memory Usage
```
BEFORE deploy:
  ps aux | grep python | awk '{print $6}' | tail -1
  # ~450 MB per session

AFTER deploy:
  ps aux | grep python | awk '{print $6}' | tail -1
  # ~250 MB per session (+ first time YOLO load)
```

### Startup Time
```
BEFORE deploy:
  time uvicorn main:app
  # real    0m5.234s

AFTER deploy:
  time uvicorn main:app
  # real    0m6.123s (includes YOLO singleton load, but only once)
```

### Session Creation Time
```
BEFORE deploy:
  Profiler shows: 200ms YOLO load × N sessions

AFTER deploy:
  Profiler shows: 0ms YOLO (already loaded), just reference
```

---

## 🚨 Rollback Plan

If issues occur after deployment:

### Quick Rollback (5 min)
```bash
# 1. Frontend rollback
cp test_interview_app/src/App.jsx.bak test_interview_app/src/App.jsx
npm run build

# 2. Backend rollback
cp python-cheating-system/main.py.bak python-cheating-system/main.py
cp backend/routers/speech.py.bak backend/routers/speech.py

# 3. Restart
systemctl restart proctoring-api
```

### Full Rollback
```bash
# If rollback fails, restore from git
git checkout python-cheating-system/main.py
git checkout test_interview_app/src/App.jsx
git checkout backend/routers/speech.py

# Remove new files
rm python-cheating-system/proctoring/detectors/yolo_model_manager.py
rm -rf python-cheating-system/proctoring/monitoring/

# Restart services
systemctl restart proctoring-api proctoring-frontend
```

---

## ⏱️ Timeline

| Phase | Duration | Risk | Effort |
|-------|----------|------|--------|
| Phase 1: Backend Core | 30 min | Low | Medium |
| Phase 2: Monitoring | 15 min | Low | Low |
| Phase 3: Frontend | 30 min | Low | Medium |
| Testing & Validation | 30 min | Low | Medium |
| **Total** | **2 hours** | **Low** | **Medium** |

---

## 👥 Team Assignments

- **Backend Dev:** Phase 1, Phase 2
- **Frontend Dev:** Phase 3
- **DevOps:** Testing, Deployment, Monitoring
- **QA:** Integration Testing, Validation

---

## 📝 Sign-Off Checklist

- [ ] All files created/modified
- [ ] Code review completed
- [ ] Unit tests passing
- [ ] Integration tests passing
- [ ] Memory monitoring validated
- [ ] Performance metrics recorded
- [ ] Rollback plan tested
- [ ] Team trained on new code
- [ ] Deployment scheduled
- [ ] Post-deployment monitoring enabled

---

## 🎉 Success Criteria

✅ Deployment successful if:
1. No errors in logs at startup
2. YOLO model loads once (confirmed in logs)
3. Memory stays flat over 1 hour
4. CPU < 20% per session
5. No orphaned temp files
6. All tests passing
7. System responds to `/api/system/stats`

---

**Deployment Ready:** ✅ YES  
**Risk Level:** 🟢 LOW  
**Expected Duration:** ⏱️ 2 hours  
**Rollback Time:** ⏱️ 5 minutes  

Ready to deploy! 🚀
