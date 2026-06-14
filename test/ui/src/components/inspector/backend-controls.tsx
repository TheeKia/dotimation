import type { BackendKind, IdleBehavior } from 'dotimation'
import type { ConfigApi } from '../../config/use-config'
import { Field } from '../controls/field'
import { Segmented } from '../controls/segmented'

export function BackendControls({ api }: { api: ConfigApi }): React.ReactNode {
  const { config, update } = api
  return (
    <>
      <Field label="backend">
        <Segmented<BackendKind>
          value={config.backend}
          options={[
            { label: 'Auto', value: 'auto' },
            { label: '2D', value: 'canvas2d' },
            { label: 'GL', value: 'webgl2' },
            { label: 'GPU', value: 'webgpu' },
          ]}
          onChange={(v) => update({ backend: v })}
        />
      </Field>
      <Field label="idle">
        <Segmented<IdleBehavior>
          value={config.idle}
          options={[
            { label: 'Sleep', value: 'sleep' },
            { label: 'Animate', value: 'animate' },
          ]}
          onChange={(v) => update({ idle: v })}
        />
      </Field>
    </>
  )
}
