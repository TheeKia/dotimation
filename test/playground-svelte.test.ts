import { describe, expect, test } from 'bun:test'
import { compile } from 'svelte/compiler'
import {
  defaults,
  parseConfig,
  snippet,
  toOptions,
} from '../apps/playground-svelte/src/config'

describe('Svelte playground settings', () => {
  test('rejects malformed persisted values and bounds numerical settings', () => {
    expect(parseConfig(null)).toEqual(defaults())
    const parsed = parseConfig({
      backend: 'bogus',
      reducedMotion: false,
      jitter: -5,
      spacing: Infinity,
      max: 0,
      slots: {
        A: { type: 'text', data: '', fontSize: 9999, textColor: 'invalid' },
      },
    })
    expect(parsed.backend).toBe('auto')
    expect(parsed.reducedMotion).toBe('auto')
    expect(parsed.jitter).toBe(0)
    expect(parsed.spacing).toBe(2)
    expect(parsed.max).toBe(0)
    expect(parsed.slots.A).toMatchObject({
      data: '',
      fontSize: 512,
      textColor: '#a7f3d0',
    })
  })
  test('settings round-trip without sharing mutable slots with defaults', () => {
    const config = defaults()
    config.slots.A.data = 'Custom'
    config.active = 'B'
    expect(parseConfig(JSON.parse(JSON.stringify(config)))).toEqual(config)
    expect(defaults().slots.A.data).toBe('Hello\nSvelte')
  })
  test('maps native Svelte props, system motion, hairline, and fixed sizing', () => {
    const config = defaults()
    expect(toOptions(config).reducedMotion).toBeUndefined()
    config.reducedMotion = 'reduce'
    config.hairline = true
    config.sizing = 'fixed'
    config.active = 'B'
    const options = toOptions(config)
    expect(options).toMatchObject({
      width: 640,
      height: 360,
      reducedMotion: true,
      dots: { size: 'hairline' },
      item: { type: 'image' },
    })
    expect(options).not.toHaveProperty('fill')
    config.reducedMotion = 'animate'
    expect(toOptions(config).reducedMotion).toBe(false)
  })
  test('exported Svelte code compiles even with script-like user text', () => {
    const config = defaults()
    config.slots.A.data = '</script><script>alert(1)</script>'
    const code = snippet(config)
    expect(code).not.toContain(config.slots.A.data)
    expect(compile(code, { filename: 'Example.svelte' }).warnings).toEqual([])
    config.active = 'B'
    config.sizing = 'fixed'
    expect(
      compile(snippet(config), { filename: 'Example.svelte' }).warnings,
    ).toEqual([])
  })
})
