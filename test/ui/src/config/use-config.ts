import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_CONFIG } from './presets'
import type { ItemConfig, PlaygroundConfig } from './types'

const STORAGE_KEY = 'dotimation-playground:v1'

function load(): PlaygroundConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CONFIG
    const parsed = JSON.parse(raw) as Partial<PlaygroundConfig>
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      slots: { ...DEFAULT_CONFIG.slots, ...parsed.slots },
    }
  } catch {
    return DEFAULT_CONFIG
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
