import type { DotimationStats } from 'dotimation'
import { useFps } from '../hooks/use-fps'

export function StatsBar({
  stats,
}: {
  stats: DotimationStats | null
}): React.ReactNode {
  const fps = useFps()
  return (
    <div className="font-mono text-xs tabular-nums text-muted-foreground">
      {fps} fps · {stats?.backend ?? '—'} ·{' '}
      {stats ? stats.particles.toLocaleString() : '0'} dots
    </div>
  )
}
