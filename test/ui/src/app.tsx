import './index.css'

import type { DotimationStats } from 'dotimation'
import { useEffect, useState } from 'react'
import { Inspector } from './components/inspector/inspector'
import { Stage } from './components/stage/stage'
import { StatsBar } from './components/stats-bar'
import { useConfig } from './config/use-config'

function Wordmark(): React.ReactNode {
  return (
    <div className="flex items-center gap-2">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <title>dotimation</title>
        {[2, 8, 14].map((y) =>
          [2, 8, 14].map((x) => (
            <circle
              key={`${x}-${y}`}
              cx={x}
              cy={y}
              r="1.4"
              fill="currentColor"
            />
          )),
        )}
      </svg>
      <span className="text-sm font-semibold tracking-tight">dotimation</span>
    </div>
  )
}

export default function App(): React.ReactNode {
  const api = useConfig()
  const [stats, setStats] = useState<DotimationStats | null>(null)
  const { swap } = api

  // Space toggles A/B (ignored while typing into a form control).
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.code !== 'Space') return
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      e.preventDefault()
      swap()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [swap])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <Wordmark />
        <StatsBar stats={stats} />
      </header>
      <div className="flex min-h-0 flex-1">
        <Inspector api={api} />
        <Stage api={api} onStats={setStats} />
      </div>
    </div>
  )
}
