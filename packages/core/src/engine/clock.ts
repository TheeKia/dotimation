export const PHYSICS_HZ = 90
export const FIXED_DT: number = 1 / PHYSICS_HZ
export const MAX_STEPS_PER_FRAME = 8
export const MAX_FRAME_DELTA: number = MAX_STEPS_PER_FRAME * FIXED_DT

/**
 * Given the carried accumulator and a frame delta (seconds), returns how many
 * fixed physics steps to run and the new accumulator. Clamps the frame delta
 * and step count to survive tab-restore spikes.
 */
export function accumulate(
  accumulator: number,
  frameDelta: number,
): { steps: number; accumulator: number } {
  const acc = accumulator + Math.min(MAX_FRAME_DELTA, frameDelta)
  const steps = Math.min(MAX_STEPS_PER_FRAME, Math.floor(acc / FIXED_DT))
  return { steps, accumulator: acc - steps * FIXED_DT }
}
