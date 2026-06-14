import { useEffect, useRef, useState } from 'react'

/** Rolling frames-per-second meter, sampled every ~500ms. */
export function useFps(): number {
  const [fps, setFps] = useState(0)
  const frames = useRef(0)
  // Init lazily in the effect — calling performance.now() during render trips
  // the playground's react-hooks/purity ESLint rule.
  const t0 = useRef(0)
  useEffect(() => {
    t0.current = performance.now()
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
