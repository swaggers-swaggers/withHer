function eligible({ now, presence, busy, paused, typingUntil, lastEvent, startedAt, lastAttempt, settings, random = Math.random }) {
  if (busy || paused || !presence.available || presence.focus || now < typingUntil) return { trigger: false, reason: 'unavailable' };
  const gap = Math.max(0, now - (lastEvent || startedAt));
  if (lastAttempt && now - lastAttempt < settings.proactive_retry_ms) return { trigger: false, reason: 'retry-cooldown' };
  if (gap >= settings.proactive_force_after_ms) return { trigger: true, reason: 'three-hours' };
  if (gap < settings.proactive_min_gap_ms) return { trigger: false, reason: 'cooldown' };
  return { trigger: random() < settings.proactive_probability, reason: 'probability' };
}
module.exports = { eligible };
