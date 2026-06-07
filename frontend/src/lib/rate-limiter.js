// ✅ NEW: src/lib/rate-limiter.js
// Per-user sliding window rate limiter for AI routes
// Uses in-memory Map — replace with Redis for multi-instance deployments

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 20; // per user

/** @type {Map<string, { count: number; windowStart: number }>} */
const userRequestMap = new Map();

// Clean up stale entries every 5 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [userId, entry] of userRequestMap.entries()) {
    if (now - entry.windowStart > WINDOW_MS * 2) {
      userRequestMap.delete(userId);
    }
  }
}, 5 * 60_000);

/**
 * Check if a user is within their rate limit.
 * @param {string} userId
 * @param {number} [maxRequests] - Override default limit
 * @returns {{ allowed: boolean; remaining: number; retryAfter?: number }}
 */
export function checkRateLimit(userId, maxRequests = MAX_REQUESTS_PER_WINDOW) {
  const now = Date.now();
  const entry = userRequestMap.get(userId);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    // New window
    userRequestMap.set(userId, { count: 1, windowStart: now });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  if (entry.count >= maxRequests) {
    const retryAfter = Math.ceil((WINDOW_MS - (now - entry.windowStart)) / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }

  entry.count++;
  return { allowed: true, remaining: maxRequests - entry.count };
}

/**
 * Rate limit Response helper — returns 429 response if rate limited.
 * @param {string} userId
 * @returns {Response | null} — null if allowed, 429 Response if rate limited
 */
export function rateLimitResponse(userId) {
  const { allowed, retryAfter } = checkRateLimit(userId);
  if (allowed) return null;
  return new Response(
    JSON.stringify({ error: "Too many requests. Please wait before trying again.", retryAfter }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": String(MAX_REQUESTS_PER_WINDOW),
        "X-RateLimit-Remaining": "0",
      },
    }
  );
}
