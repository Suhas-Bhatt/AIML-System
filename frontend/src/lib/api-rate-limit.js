const windowMs = 60_000;
const maxRequests = 60;

const hits = new Map();

const cleanup = setInterval(() => {
  const now = Date.now();
  hits.forEach((entry, key) => {
    if (entry.resetAt <= now) hits.delete(key);
  });
}, 60_000);

if (cleanup.unref) {
  cleanup.unref();
}

export function checkRateLimit(identifier) {
  const now = Date.now();
  let entry = hits.get(identifier);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 1, resetAt: now + windowMs };
    hits.set(identifier, entry);
    return null;
  }

  entry.count++;

  if (entry.count > maxRequests) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return Response.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: `Too many requests. Retry after ${retryAfter}s.`,
          retry_after: retryAfter,
        },
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(maxRequests),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(entry.resetAt / 1000)),
        },
      },
    );
  }

  return null;
}
