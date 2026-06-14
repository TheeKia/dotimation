import type { ParticleField } from '@/types'

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
