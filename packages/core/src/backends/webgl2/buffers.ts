import { QUAD, STATE_FLOATS, TARGET_FLOATS } from '../gpu-shared'

export interface GLBuffers {
  capacity: number
  quad: WebGLBuffer
  state: [WebGLBuffer, WebGLBuffer] // ping-pong
  targets: WebGLBuffer
  read: 0 | 1 // index of the current (read) state buffer
}

function makeBuffer(
  gl: WebGL2RenderingContext,
  bytes: number,
  usage: number,
): WebGLBuffer {
  const b = gl.createBuffer()
  if (!b) throw new Error('webgl2: createBuffer failed')
  gl.bindBuffer(gl.ARRAY_BUFFER, b)
  gl.bufferData(gl.ARRAY_BUFFER, bytes, usage)
  return b
}

export function createBuffers(
  gl: WebGL2RenderingContext,
  capacity: number,
): GLBuffers {
  const quad = gl.createBuffer()
  if (!quad) throw new Error('webgl2: createBuffer failed')
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW)

  const stateBytes = capacity * STATE_FLOATS * 4
  const targetBytes = capacity * TARGET_FLOATS * 4
  return {
    capacity,
    quad,
    state: [
      makeBuffer(gl, stateBytes, gl.DYNAMIC_COPY),
      makeBuffer(gl, stateBytes, gl.DYNAMIC_COPY),
    ],
    targets: makeBuffer(gl, targetBytes, gl.DYNAMIC_DRAW),
    read: 0,
  }
}

export function disposeBuffers(gl: WebGL2RenderingContext, b: GLBuffers): void {
  gl.deleteBuffer(b.quad)
  gl.deleteBuffer(b.state[0])
  gl.deleteBuffer(b.state[1])
  gl.deleteBuffer(b.targets)
}
