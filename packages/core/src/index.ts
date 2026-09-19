import {
  type ControllerHost,
  createController,
  type DotimationController,
} from './runtime/controller'

export type { DotOptions, MotionOptions } from './engine/params'
export type { ControllerHost, DotimationController } from './runtime/controller'
export type { DotimationOptions, SizeOptions } from './runtime/options'
// Compatibility types previously exported by dotimation. Keep them available
// without exposing internal constructors or module paths as public API.
export type {
  AnimateItem,
  Backend,
  BackendKind,
  DotimationStats,
  FieldTargets,
  ParticleField,
  SimParams,
} from './types'

export function createDotimationController(
  host: ControllerHost,
): DotimationController {
  return createController(host)
}
