import type { FieldTargets, ParticleField } from '@/types'

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
  const newActive = targets.count
  const oldActive = field.active
  const oldCount = field.count
  const oldFaders = oldCount - oldActive

  const f = growField(field, Math.max(oldCount, newActive + oldFaders))

  if (oldCount === 0) {
    for (let i = 0; i < newActive; i++) {
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
    f.active = newActive
    f.count = newActive
    return f
  }

  if (newActive <= oldActive) {
    for (let i = 0; i < newActive; i++) retargetActive(f, i, targets)
    for (let i = newActive; i < oldCount; i++) f.targetAlpha[i] = 0
    f.active = newActive
    f.count = oldCount
    return f
  }

  for (let j = oldFaders - 1; j >= 0; j--)
    copySlot(f, oldActive + j, newActive + j)
  for (let i = oldActive; i < newActive; i++) {
    copySlot(f, i % oldActive, i)
    f.vx[i] = 0
    f.vy[i] = 0
    f.alpha[i] = 0
  }
  for (let i = 0; i < newActive; i++) retargetActive(f, i, targets)
  f.active = newActive
  f.count = newActive + oldFaders
  return f
}
