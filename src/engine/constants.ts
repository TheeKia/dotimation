/**
 * TRANSITIONAL — being absorbed into src/engine/params.ts (see the 2026-07-28
 * params-api spec). These derived aliases keep not-yet-migrated importers on
 * the exact same values as the new defaults. Deleted in the final API task.
 */
import { DEFAULT_MOTION, COLOR_RATE as PARAMS_COLOR_RATE } from './params'

export const SETTLE_TIME: number = DEFAULT_MOTION.settleTime
export const ZETA: number = DEFAULT_MOTION.damping
export const OPACITY_RATE: number = DEFAULT_MOTION.fade
export const COLOR_RATE: number = PARAMS_COLOR_RATE
export const JITTER_AMOUNT: number = DEFAULT_MOTION.jitter
