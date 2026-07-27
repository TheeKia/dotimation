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
      <Field label="size">
        <Slider
          value={config.size}
          min={1}
          max={6}
          onChange={(v) => update({ size: v })}
        />
      </Field>
      <Field label="spacing">
        <Slider
          value={config.spacing}
          min={1}
          max={8}
          onChange={(v) => update({ spacing: v })}
        />
      </Field>
      <Field label="threshold">
        <Slider
          value={config.threshold}
          min={0}
          max={255}
          onChange={(v) => update({ threshold: v })}
        />
      </Field>
      <Field label="defaultFont">
        <Select
          value={config.defaultFontFamily}
          options={FONT_FAMILIES}
          onChange={(v) => update({ defaultFontFamily: v })}
        />
      </Field>
      <Field label="jitter">
        <Slider
          aria-label="jitter"
          value={config.jitter}
          min={0}
          max={4}
          step={0.1}
          onChange={(v) => update({ jitter: v })}
        />
      </Field>
      <Field label="settleTime">
        <Slider
          value={config.settleTime}
          min={0.2}
          max={3}
          step={0.05}
          onChange={(v) => update({ settleTime: v })}
        />
      </Field>
      <Field label="damping">
        <Slider
          value={config.damping}
          min={0.3}
          max={1}
          step={0.05}
          onChange={(v) => update({ damping: v })}
        />
      </Field>
      <Field label="fade">
        <Slider
          value={config.fade}
          min={0.5}
          max={8}
          step={0.5}
          onChange={(v) => update({ fade: v })}
        />
      </Field>
    </>
  )
}
