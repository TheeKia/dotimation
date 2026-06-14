import clsx from 'clsx'
import type { BgKind } from '../../config/types'
import type { ConfigApi } from '../../config/use-config'

const SIZE_PRESETS = [
  { label: '320', w: 320, h: 240 },
  { label: '640', w: 640, h: 360 },
  { label: '800', w: 800, h: 600 },
]

const BGS: BgKind[] = ['dark', 'light', 'checker']

function chip(active: boolean): string {
  return clsx(
    'rounded px-2 py-1 text-xs transition-colors',
    active
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:bg-primary/10 hover:text-foreground',
  )
}

export function StageToolbar({
  api,
  width,
  height,
}: {
  api: ConfigApi
  width: number
  height: number
}): React.ReactNode {
  const { config, update } = api
  const size = config.stageSize
  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs">
      <span className="font-mono tabular-nums text-muted-foreground">
        {width}×{height}
      </span>
      <div className="flex gap-0.5">
        {SIZE_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() =>
              update({ stageSize: { mode: 'preset', w: p.w, h: p.h } })
            }
            className={chip(
              size.mode === 'preset' && size.w === p.w && size.h === p.h,
            )}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => update({ stageSize: { mode: 'fill' } })}
          className={chip(size.mode === 'fill')}
        >
          Fill
        </button>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <span className="text-muted-foreground">bg</span>
        {BGS.map((b) => (
          <button
            key={b}
            type="button"
            aria-label={`Background ${b}`}
            onClick={() => update({ bg: b })}
            className={clsx(
              'size-5 rounded border',
              b === 'dark' && 'bg-[#0a0a0a]',
              b === 'light' && 'bg-[#f5f5f5]',
              b === 'checker' && 'dot-checker',
              config.bg === b ? 'border-primary' : 'border-border',
            )}
          />
        ))}
      </div>
    </div>
  )
}
