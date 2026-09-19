import { COLOR_EPS } from './rest'

/**
 * Tunes a mass-spring-damper from a target settle time and damping ratio.
 * The `4/(zeta*settleTime)` natural-frequency formula is the 2% settling-time
 * criterion, which is only accurate for `zeta <= 1` (under/critically damped).
 * `computeSettleDuration` relies on that, so passing `zeta > 1` is unsupported.
 */
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
 * Conservative simulation-time budget for position, opacity, and color.
 * `settleTime` is the spring settle target; `opacityRate` is the per-second
 * fade rate (alpha goes 0→1 or 1→0 at this rate). A safety margin is added so
 * the loop never sleeps a frame early.
 */
export function computeSettleDuration(
  settleTime: number,
  opacityRate: number,
  colorRate: number,
): number {
  const fadeTime = 1 / opacityRate
  const colorTime = Math.log(255 / COLOR_EPS) / colorRate
  return Math.max(settleTime, fadeTime, colorTime) + settleTime * 0.5 + 0.25
}
