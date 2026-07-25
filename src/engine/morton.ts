/** Interleaves the low 16 bits of x and y into a 32-bit Morton (Z-order) code. */
export function morton16(x: number, y: number): number {
  let a = x & 0xffff
  let b = y & 0xffff
  a = (a | (a << 8)) & 0x00ff00ff
  a = (a | (a << 4)) & 0x0f0f0f0f
  a = (a | (a << 2)) & 0x33333333
  a = (a | (a << 1)) & 0x55555555
  b = (b | (b << 8)) & 0x00ff00ff
  b = (b | (b << 4)) & 0x0f0f0f0f
  b = (b | (b << 2)) & 0x33333333
  b = (b | (b << 1)) & 0x55555555
  return (a | (b << 1)) >>> 0
}

/**
 * Indices [0, count) sorted by Morton code of the rounded coordinates, ties
 * broken by index. Pairing two point sets rank-by-rank in this order gives a
 * locally-coherent (nearest-ish) assignment in O(n log n) — the basis of the
 * 'spatial' reconcile matching.
 */
export function spatialOrder(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  count: number,
): Uint32Array {
  const codes = new Uint32Array(count)
  for (let i = 0; i < count; i++) {
    codes[i] = morton16(Math.round(xs[i]!), Math.round(ys[i]!))
  }
  const order = new Uint32Array(count)
  for (let i = 0; i < count; i++) order[i] = i
  return order.sort((a, b) => codes[a]! - codes[b]! || a - b)
}
