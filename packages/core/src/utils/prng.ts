/**
 * Xorshift32 PRNG shared by the hot paths (pixel sampling, per-step jitter),
 * where Math.random's cost adds up. Split into a pure step + mapping so the
 * [0, 1) contract is unit-testable: the divisor must exceed the maximum state
 * or rand() can return exactly 1 (which broke sampleTargets' shuffle bound).
 */
export function xorshift32(state: number): number {
  let s = state
  s ^= s << 13
  s ^= s >>> 17
  s ^= s << 5
  return s >>> 0
}

/** Maps a 32-bit state onto [0, 1). 2^32 > max state, so 1 is unreachable. */
export function toUnit(state: number): number {
  return state / 0x100000000
}

/** Seeded generator in [0, 1). The sequence is cosmetic (jitter/shuffle). */
export function createFastRand(seed: number): () => number {
  let s = (seed ^ 0x9e3779b9) >>> 0 || 1
  return () => {
    s = xorshift32(s)
    return toUnit(s)
  }
}
