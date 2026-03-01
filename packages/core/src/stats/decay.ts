const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Confidence decay using half-life formula.
 * formula: confidence * (0.5 ^ (days_elapsed / halflife_days))
 */
export function computeDecay(
  originalConfidence: number,
  lastConfirmedDate: Date | string,
  now: Date | string,
  halflifeDays: number = 30,
): number {
  const lastDate = typeof lastConfirmedDate === 'string' ? new Date(lastConfirmedDate) : lastConfirmedDate;
  const nowDate = typeof now === 'string' ? new Date(now) : now;

  const daysElapsed = (nowDate.getTime() - lastDate.getTime()) / MS_PER_DAY;

  if (daysElapsed <= 0) {
    return clamp(originalConfidence);
  }

  const decayed = originalConfidence * Math.pow(0.5, daysElapsed / halflifeDays);
  return clamp(decayed);
}

/**
 * Compute effective confidence for an experience.
 * Takes into account: original confidence, last confirmed date, and half-life.
 */
export function effectiveConfidence(
  confidence: number,
  lastConfirmed: string,
  halflifeDays: number = 30,
): number {
  return computeDecay(confidence, lastConfirmed, new Date(), halflifeDays);
}

function clamp(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
