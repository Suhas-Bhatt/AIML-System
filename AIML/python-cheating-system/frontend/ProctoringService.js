/**
 * ProctoringService.js
 * Drop this into your React project's services/ folder.
 * Works with the FastAPI proctoring server in main.py.
 *
 * Usage:
 *   import proctoring from './services/ProctoringService';
 *
 *   // Start monitoring
 *   await proctoring.start(sessionId, interviewId, candidateName);
 *
 *   // Listen for violations / status updates
 *   proctoring.onMessage((data) => {
 *     if (data.type === 'VIOLATION') dispatch(addViolation(data.violation));
 *     if (data.type === 'STATUS_UPDATE') dispatch(setStatus(data.status));
 *   });
 *
 *   // Stop monitoring
 *   await proctoring.stop(sessionId);
 *
 *   // Fetch full report
 *   const report = await proctoring.getReport(sessionId);
 */

const BASE_URL = import.meta.env.VITE_PROCTORING_URL || 'http://localhost:8000';
const SECRET   = import.meta.env.VITE_PROCTORING_SECRET || '';

class ProctoringService {
  constructor() {
    this._ws         = null;
    this._handlers   = [];
    this._sessionId  = null;
    this._visHandler = null;
  }

  // ── HTTP helpers ─────────────────────────────────────────────────

  _headers() {
    return {
      'Content-Type':  'application/json',
      ...(SECRET ? { 'Authorization': `Bearer ${SECRET}` } : {}),
    };
  }

  async _post(path, body = {}) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method:  'POST',
      headers: this._headers(),
      body:    JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    return res.json();
  }

  async _get(path) {
    const res = await fetch(`${BASE_URL}${path}`, { headers: this._headers() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // ── Session lifecycle ────────────────────────────────────────────

  async start(sessionId, interviewId, candidateName, cameraIndex = 0) {
    this._sessionId = sessionId;
    await this._post(`/api/sessions/${sessionId}/start`, {
      interview_id:   interviewId,
      candidate_name: candidateName,
      camera_index:   cameraIndex,
    });
    this._connectWebSocket(sessionId);
    this._startTabSwitchDetection(sessionId);
    return true;
  }

  async stop(sessionId) {
    const id = sessionId || this._sessionId;
    this._disconnectWebSocket();
    this._stopTabSwitchDetection();
    const result = await this._post(`/api/sessions/${id}/stop`);
    this._sessionId = null;
    return result;
  }

  // ── Data fetching ────────────────────────────────────────────────

  async getStatus(sessionId) {
    return this._get(`/api/sessions/${sessionId || this._sessionId}/status`);
  }

  async getViolations(sessionId) {
    return this._get(`/api/sessions/${sessionId || this._sessionId}/violations`);
  }

  async getReport(sessionId) {
    return this._get(`/api/sessions/${sessionId || this._sessionId}/report`);
  }

  getPdfUrl(sessionId) {
    const id = sessionId || this._sessionId;
    return `${BASE_URL}/api/sessions/${id}/report/pdf`;
  }

  // ── WebSocket ────────────────────────────────────────────────────

  _connectWebSocket(sessionId) {
    const wsUrl = BASE_URL.replace(/^http/, 'ws') + `/ws/${sessionId}`;
    this._ws = new WebSocket(wsUrl);

    this._ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        this._handlers.forEach(fn => fn(data));
      } catch { /* ignore malformed */ }
    };

    this._ws.onclose   = () => console.log('[Proctoring] WS closed');
    this._ws.onerror   = (e) => console.error('[Proctoring] WS error', e);

    // Keepalive ping every 30s
    this._pingInterval = setInterval(() => {
      if (this._ws?.readyState === WebSocket.OPEN) {
        this._ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30_000);
  }

  _disconnectWebSocket() {
    clearInterval(this._pingInterval);
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
  }

  onMessage(handler) {
    this._handlers.push(handler);
    return () => { this._handlers = this._handlers.filter(h => h !== handler); };
  }

  // ── Tab-switch detection ─────────────────────────────────────────

  _startTabSwitchDetection(sessionId) {
    this._visHandler = () => {
      if (document.hidden) {
        this._post(`/api/sessions/${sessionId}/event`, {
          type:      'TAB_SWITCH',
          timestamp: Date.now() / 1000,
          details:   { reason: 'visibilitychange' },
        }).catch(console.error);
      }
    };
    document.addEventListener('visibilitychange', this._visHandler);

    // Also detect window blur (e.g. alt+tab)
    this._blurHandler = () => {
      this._post(`/api/sessions/${sessionId}/event`, {
        type:      'TAB_SWITCH',
        timestamp: Date.now() / 1000,
        details:   { reason: 'window_blur' },
      }).catch(console.error);
    };
    window.addEventListener('blur', this._blurHandler);
  }

  _stopTabSwitchDetection() {
    if (this._visHandler) {
      document.removeEventListener('visibilitychange', this._visHandler);
      this._visHandler = null;
    }
    if (this._blurHandler) {
      window.removeEventListener('blur', this._blurHandler);
      this._blurHandler = null;
    }
  }
}

// Export singleton
const proctoring = new ProctoringService();
export default proctoring;
