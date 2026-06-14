import type { ParticleField } from '@/types'

// Strict convergence thresholds: the predicate must only return true once a
// transition has visually finished, so the engine never sleeps mid-morph. The
// cosmetic ±0.5px jitter is intentionally ignored (it perturbs position, not
// velocity, and stops anyway when the loop sleeps).
const VEL_EPS_SQ = 0.05 * 0.05 // (px/s)^2 — spring essentially stopped
const POS_EPS = 1 // px from home; loose enough for the ±0.5px jitter, tight
// enough to catch a not-yet-moved particle (0-step first frame on a high-refresh
// display has ~0 velocity but a large position error).
const COLOR_EPS = 0.5 // within half an 8-bit level of the home color
const ALPHA_EPS = 0.01

/**
 * True when the spring, color ease, and alpha fade have converged for every
 * live slot — i.e. nothing visible will change. Pure; O(count). Used by the
 * Canvas2D backend to let the engine sleep as soon as a transition is done.
 */
export function isFieldSettled(field: ParticleField): boolean {
  const {
    x,
    y,
    vx,
    vy,
    r,
    g,
    b,
    homeX,
    homeY,
    homeR,
    homeG,
    homeB,
    alpha,
    targetAlpha,
  } = field
  const count = field.count
  for (let i = 0; i < count; i++) {
    if (vx[i]! * vx[i]! + vy[i]! * vy[i]! > VEL_EPS_SQ) return false
    if (Math.abs(x[i]! - homeX[i]!) > POS_EPS) return false
    if (Math.abs(y[i]! - homeY[i]!) > POS_EPS) return false
    if (targetAlpha[i]! > 0.5) {
      if (alpha[i]! < 1 - ALPHA_EPS) return false
    } else if (alpha[i]! > ALPHA_EPS) {
      return false
    }
    if (Math.abs(r[i]! - homeR[i]!) > COLOR_EPS) return false
    if (Math.abs(g[i]! - homeG[i]!) > COLOR_EPS) return false
    if (Math.abs(b[i]! - homeB[i]!) > COLOR_EPS) return false
  }
  return true
}
