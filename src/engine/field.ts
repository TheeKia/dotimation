import type { FieldTargets, ParticleField } from '@/types'
import { buildTargetGrid, nearestTarget } from './collapse'
import { planReconcile } from './reconcile-plan'

const ARRAY_KEYS = [
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
] as const

export function nextPow2(n: number): number {
  if (n <= 1) return 1
  return 2 ** Math.ceil(Math.log2(n))
}

export function createField(capacity: number): ParticleField {
  const cap = nextPow2(Math.max(1, capacity))
  return {
    active: 0,
    count: 0,
    capacity: cap,
    x: new Float32Array(cap),
    y: new Float32Array(cap),
    vx: new Float32Array(cap),
    vy: new Float32Array(cap),
    homeX: new Float32Array(cap),
    homeY: new Float32Array(cap),
    r: new Float32Array(cap),
    g: new Float32Array(cap),
    b: new Float32Array(cap),
    homeR: new Float32Array(cap),
    homeG: new Float32Array(cap),
    homeB: new Float32Array(cap),
    alpha: new Float32Array(cap),
    targetAlpha: new Float32Array(cap),
  }
}

export function growField(
  field: ParticleField,
  minCapacity: number,
): ParticleField {
  if (field.capacity >= minCapacity) return field
  const next = createField(minCapacity)
  next.active = field.active
  next.count = field.count
  for (const key of ARRAY_KEYS) next[key].set(field[key])
  return next
}

function retargetActive(
  field: ParticleField,
  i: number,
  t: FieldTargets,
): void {
  field.homeX[i] = t.homeX[i]!
  field.homeY[i] = t.homeY[i]!
  field.homeR[i] = t.homeR[i]!
  field.homeG[i] = t.homeG[i]!
  field.homeB[i] = t.homeB[i]!
  field.targetAlpha[i] = 1
}

export function reconcile(
  field: ParticleField,
  targets: FieldTargets,
): ParticleField {
  const plan = planReconcile(field.active, field.count, targets.count)
  const f = growField(field, Math.max(field.count, plan.count))

  if (plan.firstLoad) {
    for (let i = 0; i < targets.count; i++) {
      f.x[i] = targets.homeX[i]!
      f.y[i] = targets.homeY[i]!
      f.vx[i] = 0
      f.vy[i] = 0
      f.r[i] = targets.homeR[i]!
      f.g[i] = targets.homeG[i]!
      f.b[i] = targets.homeB[i]!
      f.alpha[i] = 0
      retargetActive(f, i, targets)
    }
    f.active = plan.active
    f.count = plan.count
    return f
  }

  if (plan.spawn) {
    const prevActive = field.active
    for (let i = plan.spawn.start; i < plan.spawn.end; i++) {
      if (prevActive > 0) {
        // Spawn at a live particle's HOME, not its live position: under GPU
        // backends the CPU field's x/y are stale (the sim runs on the GPU),
        // while homes are authoritative on every tier and equal the live
        // position once the field has settled. Homes/targetAlpha for this
        // slot are set by retargetActive below (every spawned slot is
        // < plan.active), so nothing else needs copying from src.
        const src = i % prevActive
        f.x[i] = f.homeX[src]!
        f.y[i] = f.homeY[src]!
        f.r[i] = f.homeR[src]!
        f.g[i] = f.homeG[src]!
        f.b[i] = f.homeB[src]!
      } else {
        f.x[i] = targets.homeX[i]!
        f.y[i] = targets.homeY[i]!
        f.r[i] = targets.homeR[i]!
        f.g[i] = targets.homeG[i]!
        f.b[i] = targets.homeB[i]!
      }
      f.vx[i] = 0
      f.vy[i] = 0
      f.alpha[i] = 0
    }
  }

  for (let i = 0; i < plan.active; i++) retargetActive(f, i, targets)
  collapseFaders(f, plan.active, plan.count, targets)
  f.active = plan.active
  f.count = plan.count
  return f
}

/**
 * Completes the current morph instantly: every slot lands at its home with its
 * home color, velocities zeroed and alpha at its target; fully-faded faders are
 * dropped. Used for prefers-reduced-motion — content changes become opacity
 * fades with no movement. The result satisfies isFieldSettled.
 */
export function snapField(field: ParticleField): void {
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
    x[i] = homeX[i]!
    y[i] = homeY[i]!
    vx[i] = 0
    vy[i] = 0
    r[i] = homeR[i]!
    g[i] = homeG[i]!
    b[i] = homeB[i]!
    alpha[i] = targetAlpha[i]!
  }
  // Faders snapped to alpha 0 are invisible; drop them from the tail.
  field.count = field.active
}

/**
 * Sends every fader [active, count) home to the nearest surviving target so it
 * drifts into the new layout while fading, instead of dissolving in place at the
 * old image's position. Falls back to fading in place when the new image is
 * empty (no survivor to collapse toward).
 */
function collapseFaders(
  f: ParticleField,
  active: number,
  count: number,
  targets: FieldTargets,
): void {
  if (count <= active) return
  if (targets.count === 0) {
    for (let i = active; i < count; i++) f.targetAlpha[i] = 0
    return
  }
  const grid = buildTargetGrid(targets, targets.count)
  for (let i = active; i < count; i++) {
    // Match from the fader's HOME (its slot in the outgoing layout), not its
    // live position: live x/y are stale under GPU backends, and on settled
    // fields home equals the live position anyway.
    const j = nearestTarget(grid, f.homeX[i]!, f.homeY[i]!)
    f.homeX[i] = targets.homeX[j]!
    f.homeY[i] = targets.homeY[j]!
    f.homeR[i] = targets.homeR[j]!
    f.homeG[i] = targets.homeG[j]!
    f.homeB[i] = targets.homeB[j]!
    f.targetAlpha[i] = 0
  }
}
