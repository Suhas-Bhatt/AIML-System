export function effectiveNowForSession(lastActivityAt, nowMs) {
  const lastAct = lastActivityAt ? new Date(lastActivityAt).getTime() : nowMs;
  // If last activity was > 10 min ago, cap it. Otherwise use now.
  if (nowMs - lastAct > 10 * 60 * 1000) {
    return lastAct + 10 * 60 * 1000;
  }
  return nowMs;
}

export function computeSegmentDuration(segments, cappedNowMs) {
  let totalMs = 0;
  for (const s of segments) {
    const start = new Date(s.joinedAt).getTime();
    const end = s.leftAt ? new Date(s.leftAt).getTime() : cappedNowMs;
    if (end > start) totalMs += (end - start);
  }
  return Math.round(totalMs / 1000);
}

export function computeMessageBasedDuration(startedAtMs, msgTimesMs, cappedNowMs) {
  if (!msgTimesMs || msgTimesMs.length === 0) {
    return Math.round((cappedNowMs - startedAtMs) / 1000);
  }
  const lastMsgTime = msgTimesMs[msgTimesMs.length - 1];
  const endMs = Math.min(cappedNowMs, lastMsgTime + 60 * 1000); // 1 min after last msg
  return Math.max(0, Math.round((endMs - startedAtMs) / 1000));
}
