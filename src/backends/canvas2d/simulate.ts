import type { ParticleField } from '@/types'

const COLOR_RATE = 2
const OPACITY_RATE = 2
const JITTER_AMOUNT = 1

function expLerp(
  current: number,
  target: number,
  rate: number,
  dt: number,
): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt))
}

/**
 * Advances every slot one fixed step and compacts dead faders (targetAlpha 0
 * that have faded below epsilon) off the tail. `rand` is injectable for
 * deterministic tests.
 */
export function stepField(
  field: ParticleField,
  dt: number,
  k: number,
  c: number,
  rand: () => number = Math.random,
): void {
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
    r[i] = expLerp(r[i]!, homeR[i]!, COLOR_RATE, dt)
    g[i] = expLerp(g[i]!, homeG[i]!, COLOR_RATE, dt)
    b[i] = expLerp(b[i]!, homeB[i]!, COLOR_RATE, dt)
    const delta = OPACITY_RATE * dt
    alpha[i] =
      targetAlpha[i]! > 0.5
        ? Math.min(1, alpha[i]! + delta)
        : Math.max(0, alpha[i]! - delta)
  }

  // Compact dead faders (targetAlpha 0 and alpha ~ 0) from the tail.
  let i = field.count
  while (i > field.active) {
    i--
    if (targetAlpha[i]! < 0.5 && alpha[i]! <= 0.001) {
      const last = field.count - 1
      if (i !== last) {
        for (const key of [
          'x',
          'y',
          'vx',
          'vy',
          'homeX',
          'homeY',
          'r',
          'g',
          'b',
          'homeR',
          'homeG',
          'homeB',
          'alpha',
          'targetAlpha',
        ] as const) {
          field[key][i] = field[key][last]!
        }
      }
      field.count--
    }
  }
}
