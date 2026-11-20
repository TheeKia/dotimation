import { afterEach, expect, mock, test } from 'bun:test'
import {
  detectCapabilities,
  isSoftwareRenderer,
} from '../../src/engine/backend'

const RENDERER = 0x1f01
const UNMASKED_RENDERER_WEBGL = 0x9246
const CHROME_MASK = 'WebKit WebGL'

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
afterEach(() => {
  if (originalDocument)
    Object.defineProperty(globalThis, 'document', originalDocument)
  else Reflect.deleteProperty(globalThis, 'document')
})

/** A WebGL2 probe reporting `renderer`, unmaskable to `unmasked` when given. */
function probeHarness(renderer: string, unmasked?: string) {
  const loseContext = mock(() => {})
  const requested: string[] = []
  const gl = {
    RENDERER,
    getParameter: (name: number) => {
      if (name === RENDERER) return renderer
      if (name === UNMASKED_RENDERER_WEBGL && unmasked !== undefined)
        return unmasked
      return null
    },
    getExtension: (name: string) => {
      requested.push(name)
      if (name === 'WEBGL_lose_context') return { loseContext }
      if (name === 'WEBGL_debug_renderer_info' && unmasked !== undefined)
        return { UNMASKED_RENDERER_WEBGL }
      return null
    },
  }
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => ({ getContext: () => gl }) },
  })
  return { loseContext, requested }
}

test('software rasterizers are recognized by their renderer names', () => {
  for (const name of [
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    'Google SwiftShader',
    'llvmpipe (LLVM 17.0.6, 256 bits)',
    'llvmpipe, or similar',
    'softpipe',
    'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
  ])
    expect(isSoftwareRenderer(name)).toBe(true)
  for (const name of [
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 (0x00002684) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
    'Apple GPU',
    'Mesa Intel(R) UHD Graphics 620 (KBL GT2)',
    CHROME_MASK,
  ])
    expect(isSoftwareRenderer(name)).toBe(false)
})

test('a masked hardware renderer keeps WebGL2 and releases the probe', () => {
  const h = probeHarness(
    CHROME_MASK,
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  )
  expect(detectCapabilities().webgl2).toBe(true)
  expect(h.loseContext).toHaveBeenCalledTimes(1)
})

test('a masked software renderer is resolved through the debug extension', () => {
  const h = probeHarness(CHROME_MASK, 'ANGLE (Google, SwiftShader driver)')
  expect(detectCapabilities().webgl2).toBe(false)
  expect(h.loseContext).toHaveBeenCalledTimes(1)
})

test('an unmasked renderer never requests the debug extension', () => {
  const h = probeHarness('llvmpipe, or similar', 'unused')
  expect(detectCapabilities().webgl2).toBe(false)
  expect(h.requested).not.toContain('WEBGL_debug_renderer_info')
})

test('an unmasked hardware renderer keeps WebGL2', () => {
  probeHarness('NVIDIA GeForce GTX 980, or similar')
  expect(detectCapabilities().webgl2).toBe(true)
})

test('hardware WebGL2 stays available when the renderer cannot be unmasked', () => {
  probeHarness(CHROME_MASK)
  expect(detectCapabilities().webgl2).toBe(true)
})
