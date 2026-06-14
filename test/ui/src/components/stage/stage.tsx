import clsx from 'clsx'
import type { DotimationStats } from 'dotimation'
import { Dotimation } from 'dotimation'
import { toAnimateItem } from '../../config/to-item'
import type { BgKind, StageSize } from '../../config/types'
import type { ConfigApi } from '../../config/use-config'
import { useElementSize } from '../../hooks/use-element-size'
import { ResizeHandle } from './resize-handle'
import { StageToolbar } from './stage-toolbar'

const BG_CLASS: Record<BgKind, string> = {
  dark: 'bg-[#0a0a0a]',
  light: 'bg-[#f5f5f5]',
  checker: 'dot-checker',
}

function resolveSize(
  size: StageSize,
  availW: number,
  availH: number,
): { width: number; height: number } {
  if (availW <= 0 || availH <= 0) return { width: 0, height: 0 }
  if (size.mode === 'fill') return { width: availW, height: availH }
  return { width: Math.min(size.w, availW), height: Math.min(size.h, availH) }
}

export function Stage({
  api,
  onStats,
}: {
  api: ConfigApi
  onStats: (s: DotimationStats) => void
}): React.ReactNode {
  const { config, update, swap } = api
  const [areaRef, area] = useElementSize<HTMLDivElement>()
  const { width, height } = resolveSize(
    config.stageSize,
    area.width,
    area.height,
  )
  const item = toAnimateItem(config.slots[config.active])

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <StageToolbar api={api} width={width} height={height} />
      <div
        ref={areaRef}
        className="flex min-h-0 flex-1 items-center justify-center p-4"
      >
        <div
          className={clsx(
            'relative overflow-hidden rounded-lg border border-border shadow-inner',
            BG_CLASS[config.bg],
          )}
          style={{ width, height }}
        >
          {width > 0 && height > 0 && (
            <Dotimation
              item={item}
              width={width}
              height={height}
              dotSize={config.dotSize}
              pointSpacingCss={config.pointSpacingCss}
              alpha={config.alpha}
              defaultFontFamily={config.defaultFontFamily}
              backend={config.backend}
              idle={config.idle}
              maxParticles={config.maxParticles}
              onStats={onStats}
            />
          )}
          <ResizeHandle
            maxW={area.width}
            maxH={area.height}
            onResize={(w, h) => update({ stageSize: { mode: 'custom', w, h } })}
          />
        </div>
      </div>
      <div className="flex items-center justify-center pb-3">
        <button
          type="button"
          onClick={swap}
          className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground"
        >
          ⇄ Swap A/B
          <kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]">
            Space
          </kbd>
        </button>
      </div>
    </section>
  )
}
