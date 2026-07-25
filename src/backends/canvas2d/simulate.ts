import { COLOR_RATE, JITTER_AMOUNT, OPACITY_RATE } from '@/engine/constants'
import { ALPHA_EPS, COLOR_EPS, POS_EPS, VEL_EPS_SQ } from '@/engine/rest'
import type { ParticleField } from '@/types'
import { createFastRand } from '../../utils/prng'

// Cheap seeded PRNG for the per-particle jitter. Called once per particle per
// step, so it sits squarely on the hot path where Math.random's cost adds up;
// the exact sequence is cosmetic (a horizontal shimmer only). `rand` stays
// injectable below so tests remain deterministic.
const fastRand = createFastRand(Date.now())

/**
 * Advances every slot one fixed step and compacts dead faders (targetAlpha 0
 * that have faded below epsilon) off the tail. Returns true when every slot
 * satisfies the same convergence predicate as isFieldSettled — evaluated
 * inline so the engine's per-frame settled() check is O(1) instead of a
 * second O(count) pass. `rand` is injectable for deterministic tests.
 */
export function stepField(
  field: ParticleField,
  dt: number,
  k: number,
  c: number,
  rand: () => number = fastRand,
): boolean {
  const {
    x,
    y,
    vx,
    vy,
    homeX,
    homeY,
    r,
    g,
    b,
    homeR,
    homeG,
    homeB,
    alpha,
    targetAlpha,
  } = field

  // The color ease and alpha fade depend only on the (fixed) step `dt`, not on
  // any per-particle state, so they are identical for every particle this step.
  // Compute them once instead of re-evaluating Math.exp three times per particle.
  const colorFactor = 1 - Math.exp(-COLOR_RATE * dt)
  const delta = OPACITY_RATE * dt

  let settled = true
  for (let i = 0; i < field.count; i++) {
    const ax = k * (homeX[i]! - x[i]!) - c * vx[i]!
    const ay = k * (homeY[i]! - y[i]!) - c * vy[i]!
    vx[i]! += ax * dt
    vy[i]! += ay * dt
    // Jitter is applied to X only — a deliberate horizontal shimmer carried
    // over from the original engine. Do not add Y jitter without intent: it
    // would change the established visual look.
    x[i]! += vx[i]! * dt + (rand() - 0.5) * JITTER_AMOUNT
    y[i]! += vy[i]! * dt
    r[i] = r[i]! + (homeR[i]! - r[i]!) * colorFactor
    g[i] = g[i]! + (homeG[i]! - g[i]!) * colorFactor
    b[i] = b[i]! + (homeB[i]! - b[i]!) * colorFactor
    alpha[i] =
      targetAlpha[i]! > 0.5
        ? Math.min(1, alpha[i]! + delta)
        : Math.max(0, alpha[i]! - delta)
    if (
      settled &&
      (vx[i]! * vx[i]! + vy[i]! * vy[i]! > VEL_EPS_SQ ||
        Math.abs(x[i]! - homeX[i]!) > POS_EPS ||
        Math.abs(y[i]! - homeY[i]!) > POS_EPS ||
        (targetAlpha[i]! > 0.5
          ? alpha[i]! < 1 - ALPHA_EPS
          : alpha[i]! > ALPHA_EPS) ||
        Math.abs(r[i]! - homeR[i]!) > COLOR_EPS ||
        Math.abs(g[i]! - homeG[i]!) > COLOR_EPS ||
        Math.abs(b[i]! - homeB[i]!) > COLOR_EPS)
    ) {
      settled = false
    }
  }

  // Compact dead faders (targetAlpha 0 and alpha ~ 0) from the tail.
  let i = field.count
  while (i > field.active) {
    i--
    if (targetAlpha[i]! < 0.5 && alpha[i]! <= 0.001) {
      const last = field.count - 1
      if (i !== last) {
        // Inlined swap over the destructured SoA views — avoids allocating a
        // key array and doing dynamic property access per compacted fader.
        x[i] = x[last]!
        y[i] = y[last]!
        vx[i] = vx[last]!
        vy[i] = vy[last]!
        homeX[i] = homeX[last]!
        homeY[i] = homeY[last]!
        r[i] = r[last]!
        g[i] = g[last]!
        b[i] = b[last]!
        homeR[i] = homeR[last]!
        homeG[i] = homeG[last]!
        homeB[i] = homeB[last]!
        alpha[i] = alpha[last]!
        targetAlpha[i] = targetAlpha[last]!
      }
      field.count--
    }
  }
  return settled
}
