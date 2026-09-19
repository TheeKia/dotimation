import type { Dotimation, DotimationProps } from '@dotimation/svelte'
import type { ComponentProps } from 'svelte'

const props: DotimationProps = {
  item: { type: 'text', data: 'x' },
  fill: true,
  class: ['dots', { active: true }],
  style: 'opacity: 0.5',
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
// @ts-expect-error React presentation props are not Svelte props
const invalidClass: DotimationProps = { ...props, className: 'x' }
// @ts-expect-error React refs are not Svelte props
const invalidRef: DotimationProps = { ...props, ref: { current: null } }
void [inferred, invalidSize, incomplete, invalidClass, invalidRef]
