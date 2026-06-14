import type { ConfigApi } from '../../config/use-config'
import { Field } from '../controls/field'
import { Slider } from '../controls/slider'
import { Toggle } from '../controls/toggle'

export function PerformanceControls({
  api,
}: {
  api: ConfigApi
}): React.ReactNode {
  const { config, update, reset } = api
  const capped = config.maxParticles !== undefined
  return (
    <>
      <Field label="cap dots">
        <Toggle
          checked={capped}
          onChange={(v) => update({ maxParticles: v ? 20000 : undefined })}
        />
      </Field>
      {capped && (
        <Field label="maxParticles">
          <Slider
            value={config.maxParticles ?? 20000}
            min={1000}
            max={50000}
            step={1000}
            onChange={(v) => update({ maxParticles: v })}
          />
        </Field>
      )}
      <div className="pt-2">
        <button
          type="button"
          onClick={reset}
          className="w-full rounded border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-foreground"
        >
          ↺ Reset all
        </button>
      </div>
    </>
  )
}
