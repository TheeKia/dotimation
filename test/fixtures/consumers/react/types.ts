import type {
  Backend,
  Dotimation,
  DotimationProps,
  FieldTargets,
  ParticleField,
  SimParams,
} from '@kiaa/dotimation-react'
import type { ComponentProps } from 'react'

const props: DotimationProps = {
  item: { type: 'text', data: 'x' },
  fill: true,
  ref: { current: null },
  style: { opacity: 0.5 },
}
const inferred: ComponentProps<typeof Dotimation> = props
// @ts-expect-error fixed size and fill are mutually exclusive
const invalidSize: DotimationProps = {
  item: { type: 'text', data: 'x' },
  fill: true,
  width: 100,
  height: 100,
}
// @ts-expect-error both fixed dimensions are required
const incomplete: DotimationProps = {
  item: { type: 'text', data: 'x' },
  width: 100,
}
// @ts-expect-error Svelte presentation props are not React props
const invalidClass: DotimationProps = { ...props, class: 'x' }
// @ts-expect-error dimensions are controlled through sizing props
const invalidStyle: DotimationProps = { ...props, style: { width: 100 } }
export type LegacyTypes = [Backend, FieldTargets, ParticleField, SimParams]
void [inferred, invalidSize, incomplete, invalidClass, invalidStyle]
