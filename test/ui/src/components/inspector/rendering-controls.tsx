import type { ConfigApi } from '../../config/use-config'
import { Field } from '../controls/field'
import { Select } from '../controls/select'
import { Slider } from '../controls/slider'

const FONT_FAMILIES = [
  { label: 'sans-serif', value: 'sans-serif' },
  { label: 'serif', value: 'serif' },
  { label: 'monospace', value: 'monospace' },
  { label: 'system-ui', value: 'system-ui' },
]

export function RenderingControls({
  api,
}: {
  api: ConfigApi
}): React.ReactNode {
  const { config, update } = api
  return (
    <>
      <Field label="dotSize">
        <Slider
          value={config.dotSize}
          min={1}
          max={6}
          onChange={(v) => update({ dotSize: v })}
        />
      </Field>
      <Field label="spacing">
        <Slider
          value={config.pointSpacingCss}
          min={1}
          max={8}
          onChange={(v) => update({ pointSpacingCss: v })}
        />
      </Field>
      <Field label="alpha">
        <Slider
          value={config.alpha}
          min={0}
          max={255}
          onChange={(v) => update({ alpha: v })}
        />
      </Field>
      <Field label="defaultFont">
        <Select
          value={config.defaultFontFamily}
          options={FONT_FAMILIES}
          onChange={(v) => update({ defaultFontFamily: v })}
        />
      </Field>
    </>
  )
}
