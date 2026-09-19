import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_CONFIG } from './presets'
import type { ItemConfig, PlaygroundConfig } from './types'

const STORAGE_KEY = 'dotimation-playground:v1'

/**
 * e2e hook: `?jitter=0` (or any number) overrides the persisted/default
 * jitter value at load time. The playground has no other way to force a
 * specific jitter on first paint (it's a live-editable slider, not a URL
 * concern), so the smoke suite drives the "jitter 0 sleeps" / "shimmer
 * persists" scenarios this way. Not otherwise part of the playground's UX.
 */
function applyQueryOverrides(config: PlaygroundConfig): PlaygroundConfig {
  if (typeof location === 'undefined') return config
  const jitterParam = new URLSearchParams(location.search).get('jitter')
  if (jitterParam === null) return config
  const jitter = Number(jitterParam)
  return Number.isFinite(jitter) ? { ...config, jitter } : config
}

function load(): PlaygroundConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return applyQueryOverrides(DEFAULT_CONFIG)
    const parsed = JSON.parse(raw) as Partial<PlaygroundConfig>
    return applyQueryOverrides({
      ...DEFAULT_CONFIG,
      ...parsed,
      slots: { ...DEFAULT_CONFIG.slots, ...parsed.slots },
    })
  } catch {
    return applyQueryOverrides(DEFAULT_CONFIG)
  }
}

export type ConfigApi = {
  config: PlaygroundConfig
  update: (patch: Partial<PlaygroundConfig>) => void
  setActiveItem: (item: ItemConfig) => void
  updateActiveItem: (fn: (item: ItemConfig) => ItemConfig) => void
  swap: () => void
  reset: () => void
}

export function useConfig(): ConfigApi {
  const [config, setConfig] = useState<PlaygroundConfig>(load)

  // Persist (debounced so slider drags don't thrash localStorage).
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
      } catch {
        // ignore quota / unavailable storage
      }
    }, 150)
    return () => clearTimeout(id)
  }, [config])

  const update = useCallback((patch: Partial<PlaygroundConfig>) => {
    setConfig((c) => ({ ...c, ...patch }))
  }, [])

  const setActiveItem = useCallback((item: ItemConfig) => {
    setConfig((c) => ({ ...c, slots: { ...c.slots, [c.active]: item } }))
  }, [])

  const updateActiveItem = useCallback(
    (fn: (item: ItemConfig) => ItemConfig) => {
      setConfig((c) => ({
        ...c,
        slots: { ...c.slots, [c.active]: fn(c.slots[c.active]) },
      }))
    },
    [],
  )

  const swap = useCallback(() => {
    setConfig((c) => ({ ...c, active: c.active === 'A' ? 'B' : 'A' }))
  }, [])

  const reset = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
    setConfig(DEFAULT_CONFIG)
  }, [])

  return { config, update, setActiveItem, updateActiveItem, swap, reset }
}
