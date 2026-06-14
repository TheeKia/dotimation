export function tuneSpring({
  settleTime,
  zeta,
}: {
  settleTime: number
  zeta: number
}): {
  k: number
  c: number
} {
  const wn = 4 / (zeta * settleTime)
  return { k: wn * wn, c: 2 * zeta * wn }
}

/**
 * Worst-case seconds until particles are both at rest and fully faded.
 * `settleTime` is the spring settle target; `opacityRate` is the per-second
 * fade rate (alpha goes 0→1 or 1→0 at this rate). A safety margin is added so
 * the loop never sleeps a frame early.
 */
export function computeSettleDuration(
  settleTime: number,
  opacityRate: number,
): number {
  const fadeTime = 1 / opacityRate
  return Math.max(settleTime, fadeTime) + settleTime * 0.5 + 0.25
}
