import type { FieldTargets, ParticleField } from '@/types'
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

function copySlot(field: ParticleField, src: number, dst: number): void {
  for (const key of ARRAY_KEYS) field[key][dst] = field[key][src]!
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

  if (plan.relocate) {
    for (let j = plan.relocate.len - 1; j >= 0; j--) {
      copySlot(f, plan.relocate.from + j, plan.relocate.to + j)
    }
  }

  if (plan.spawn) {
    const prevActive = field.active
    for (let i = plan.spawn.start; i < plan.spawn.end; i++) {
      if (prevActive > 0) {
        copySlot(f, i % prevActive, i)
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
  for (let i = plan.active; i < plan.count; i++) f.targetAlpha[i] = 0
  f.active = plan.active
  f.count = plan.count
  return f
}
