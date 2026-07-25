import { OPACITY_RATE } from '@/engine/constants'
import type { ParticleField } from '@/types'

/**
 * Interleaved GPU buffer layout + packing shared by the WebGL2 and WebGPU
 * backends. Both tiers upload the same [x,y,vx,vy,r,g,b,alpha] state stride
 * and [homeX,homeY,homeR,homeG,homeB,targetAlpha] target stride, so the
 * layout constants and packers live here — a single source the tiers cannot
 * drift from.
 */
export const STATE_FLOATS = 8
export const TARGET_FLOATS = 6
export const STATE_STRIDE_BYTES: number = STATE_FLOATS * 4

/** Unit quad as a triangle strip (4 corners in [0,1]). */
export const QUAD: Float32Array = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1])

/**
 * Faders fade out at OPACITY_RATE; after this long they are invisible and the
 * tail can be dropped. The Canvas2D backend compacts faders in stepField; the
 * GPU sims don't change count, so the backends expire them by elapsed time.
 */
export const FADE_DURATION_MS: number = (1 / OPACITY_RATE + 0.15) * 1000

/** Writes interleaved state [x,y,vx,vy,r,g,b,alpha] for slots [start,end) into `out`; returns the used view. */
export function packStateInto(
  out: Float32Array,
  field: ParticleField,
  start: number,
  end: number,
): Float32Array {
  let o = 0
  for (let i = start; i < end; i++) {
    out[o++] = field.x[i]!
    out[o++] = field.y[i]!
    out[o++] = field.vx[i]!
    out[o++] = field.vy[i]!
    out[o++] = field.r[i]!
    out[o++] = field.g[i]!
    out[o++] = field.b[i]!
    out[o++] = field.alpha[i]!
  }
  return out.subarray(0, o)
}

/** Writes interleaved targets for slots [0,count) into `out`; returns the used view. */
export function packTargetsInto(
  out: Float32Array,
  field: ParticleField,
  count: number,
): Float32Array {
  let o = 0
  for (let i = 0; i < count; i++) {
    out[o++] = field.homeX[i]!
    out[o++] = field.homeY[i]!
    out[o++] = field.homeR[i]!
    out[o++] = field.homeG[i]!
    out[o++] = field.homeB[i]!
    out[o++] = field.targetAlpha[i]!
  }
  return out.subarray(0, o)
}

/** Returns `scratch` when it can hold `floats`, else a fresh larger array. */
export function ensureScratch(
  scratch: Float32Array<ArrayBuffer>,
  floats: number,
): Float32Array<ArrayBuffer> {
  return scratch.length >= floats ? scratch : new Float32Array(floats)
}
