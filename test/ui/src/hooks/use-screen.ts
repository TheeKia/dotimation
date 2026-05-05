import { useSyncExternalStore } from 'react'

type Screen = { width: number; height: number }

let cached: Screen = { width: 0, height: 0 }

function getSnapshot(): Screen {
  // Only allocate a new object when values actually change,
  // so Object.is keeps a stable reference between renders.
  if (
    cached.width !== window.innerWidth ||
    cached.height !== window.innerHeight
  ) {
    cached = { width: window.innerWidth, height: window.innerHeight }
  }
  return cached
}

const SERVER_SNAPSHOT: Screen = { width: 0, height: 0 }
function getServerSnapshot(): Screen {
  return SERVER_SNAPSHOT
}

function subscribe(callback: () => void) {
  const controller = new AbortController()
  window.addEventListener('resize', callback, { signal: controller.signal })
  return () => controller.abort()
}

export function useScreen(): Screen {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
