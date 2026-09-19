import { expect, mock, test } from 'bun:test'
import { createProgram } from '@/backends/webgl2/gl'

test('fragment compilation failure releases the program and both shaders', () => {
  let compiled = 0
  const deleteProgram = mock(() => {})
  const deleteShader = mock(() => {})
  const gl = {
    createProgram: () => ({}),
    createShader: () => ({}),
    shaderSource() {},
    compileShader() {},
    getShaderParameter: () => ++compiled === 1,
    getShaderInfoLog: () => 'invalid shader',
    deleteProgram,
    deleteShader,
  } as unknown as WebGL2RenderingContext
  expect(() => createProgram(gl, 'vertex', 'fragment')).toThrow(
    'invalid shader',
  )
  expect(deleteProgram).toHaveBeenCalledTimes(1)
  expect(deleteShader).toHaveBeenCalledTimes(2)
})
