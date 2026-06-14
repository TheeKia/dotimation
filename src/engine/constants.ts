/**
 * Simulation constants shared across the engine and every backend.
 *
 * These are load-bearing and coupled: `engine.ts` derives the settle/sleep
 * duration from `SETTLE_TIME` + `OPACITY_RATE`, while each backend's spring
 * (`SETTLE_TIME`, `ZETA`) and fade (`OPACITY_RATE`) must match or the loop will
 * sleep before particles have visually settled. Keep them here so the P1/P2 GPU
 * backends cannot silently drift from the Canvas2D reference.
 */

/** Spring settle-time target (seconds) — see tuneSpring. */
export const SETTLE_TIME = 0.85
/** Damping ratio. 1 = critically damped. Must stay <= 1 (see tuneSpring). */
export const ZETA = 1
/** Per-second alpha fade rate (alpha eases toward targetAlpha at this rate). */
export const OPACITY_RATE = 2
/** Per-second color ease rate toward home color. */
export const COLOR_RATE = 2
/**
 * Per-step horizontal nudge (px) applied to X for the shimmer effect. Applied
 * every physics step by both backends (Canvas2D in stepField, WebGL2 in the sim
 * shader) so the shimmer frequency matches across tiers.
 */
export const JITTER_AMOUNT = 1
