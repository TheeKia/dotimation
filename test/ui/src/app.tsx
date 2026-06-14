import './index.css'

import clsx from 'clsx'
import { type AnimateItem, type BackendKind, Dotimation } from 'dotimation'
import { useEffect, useRef, useState } from 'react'
import { useScreen } from './hooks/use-screen'

const TEST_ITEMS: { label: string; item: AnimateItem }[] = [
  {
    label: 'Auto Size',
    item: {
      type: 'text',
      data: 'Hello\nThis is a second line',
      fontSize: 'AUTO',
      fontFamily: 'sans-serif',
      textColor: 'rgb(255,0,255)',
    },
  },
  {
    label: 'Auto Size (Short)',
    item: {
      type: 'text',
      data: 'Hello',
      fontSize: 'AUTO',
      fontFamily: 'sans-serif',
    },
  },
  {
    label: 'Auto Mono Size',
    item: {
      type: 'text',
      data: 'Hello\nThis is a second line',
      fontSize: 'AUTO_MONO',
      fontFamily: 'monospace',
    },
  },
  {
    label: 'Fixed Size',
    item: { type: 'text', data: 'Hi', fontSize: 30 },
  },
  {
    label: 'Image',
    item: {
      type: 'image',
      data: 'https://th-wave.s3.us-east-1.amazonaws.com/general/logo.svg',
    },
  },
  {
    label: 'Image (Inverted)',
    item: {
      type: 'image',
      data: 'https://th-wave.s3.us-east-1.amazonaws.com/general/logo.svg',
      invert: true,
    },
  },
]

function useFps(): number {
  const [fps, setFps] = useState(0)
  const frames = useRef(0)
  const t0 = useRef(performance.now())
  useEffect(() => {
    let id = 0
    const tick = (): void => {
      frames.current++
      const now = performance.now()
      if (now - t0.current >= 500) {
        setFps(Math.round((frames.current * 1000) / (now - t0.current)))
        frames.current = 0
        t0.current = now
      }
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [])
  return fps
}

export function App() {
  const [item, setItem] = useState<AnimateItem>(TEST_ITEMS[0].item)
  const [backend, setBackend] = useState<BackendKind>('auto')
  const [dotSize, setDotSize] = useState(1)
  const screen = useScreen()
  const fps = useFps()

  return (
    <main className="flex size-screen pt-3">
      <div className="fixed top-2 left-2 text-xs font-mono opacity-70">
        {fps} fps · {backend} · dot {dotSize}
      </div>
      <Dotimation
        item={item}
        width={screen.width}
        height={screen.height - 48}
        backend={backend}
        dotSize={dotSize}
      />
      <div className="fixed bottom-2 inset-x-0 w-full flex flex-wrap items-center justify-center gap-1">
        {TEST_ITEMS.map(({ label, item: data }) => (
          <button
            key={label}
            type="button"
            onClick={() => setItem(data)}
            className={clsx(
              'cursor-pointer hover:bg-primary/10 px-2 h-7 rounded-md text-xs',
              data === item && 'bg-primary/10',
            )}
          >
            {label}
          </button>
        ))}
        {(['auto', 'canvas2d'] as BackendKind[]).map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setBackend(b)}
            className={clsx(
              'cursor-pointer hover:bg-primary/10 px-2 h-7 rounded-md text-xs',
              backend === b && 'bg-primary/10',
            )}
          >
            {b}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setDotSize((d) => (d === 1 ? 2 : 1))}
          className="cursor-pointer hover:bg-primary/10 px-2 h-7 rounded-md text-xs"
        >
          dotSize
        </button>
      </div>
    </main>
  )
}

export default App
