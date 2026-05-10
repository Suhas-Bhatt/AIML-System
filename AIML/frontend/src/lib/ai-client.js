/**
 * AI Client for communicating with the Python FastAPI Proctoring Service.
 */

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

export const aiClient = {
  /**
   * Start a proctoring session
   */
  startSession: async (sessionId, referenceFrame) => {
    try {
      const response = await fetch(`${AI_SERVICE_URL}/session/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, reference_frame: referenceFrame }),
      });
      return await response.json();
    } catch (error) {
      console.error('Failed to start AI proctoring session:', error);
      throw error;
    }
  },

  /**
   * Stop a proctoring session
   */
  stopSession: async (sessionId) => {
    try {
      const response = await fetch(`${AI_SERVICE_URL}/session/stop/${sessionId}`, {
        method: 'POST',
      });
      return await response.json();
    } catch (error) {
      console.error('Failed to stop AI proctoring session:', error);
      throw error;
    }
  },

  /**
   * Get health status of the AI service
   */
  getHealth: async () => {
    try {
      const response = await fetch(`${AI_SERVICE_URL}/health`);
      return await response.json();
    } catch (error) {
      console.error('AI service health check failed:', error);
      return { status: 'unhealthy', error: String(error) };
    }
  },

  /**
   * Request session evaluation (Strengths, Weaknesses, Insights)
   */
  evaluateSession: async (data) => {
    try {
      const response = await fetch(`${AI_SERVICE_URL}/session/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return await response.json();
    } catch (error) {
      console.error('AI session evaluation failed:', error);
      throw error;
    }
  },
};
