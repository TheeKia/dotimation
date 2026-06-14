import { STATE_FLOATS } from '@/engine/reconcile-plan'
import { createProgram } from './gl'
import { DRAW_FRAG } from './shaders/draw.frag'
import { DRAW_VERT } from './shaders/draw.vert'

export interface DrawProgram {
  /**
   * (Re)bind the ping-pong state buffers and the shared quad. Bakes the
   * attribute layout into one VAO per read index. Call after the buffers are
   * created or grown.
   */
  setBuffers(state0: WebGLBuffer, state1: WebGLBuffer, quad: WebGLBuffer): void
  /** Draw the instanced dots from state[read]. */
  use(read: 0 | 1, count: number, u: DrawUniforms): void
  dispose(): void
}

export interface DrawUniforms {
  devW: number
  devH: number
  dpr: number
  dotSize: number
}

const STRIDE = STATE_FLOATS * 4

export function createDrawProgram(gl: WebGL2RenderingContext): DrawProgram {
  const program = createProgram(gl, DRAW_VERT, DRAW_FRAG)
  const aCorner = gl.getAttribLocation(program, 'aCorner')
  const aPos = gl.getAttribLocation(program, 'aInstancePos')
  const aColor = gl.getAttribLocation(program, 'aInstanceColor')
  const aAlpha = gl.getAttribLocation(program, 'aInstanceAlpha')
  const uDevW = gl.getUniformLocation(program, 'uDevW')
  const uDevH = gl.getUniformLocation(program, 'uDevH')
  const uDpr = gl.getUniformLocation(program, 'uDpr')
  const uDotSize = gl.getUniformLocation(program, 'uDotSize')
  let vaos: [WebGLVertexArrayObject, WebGLVertexArrayObject] | null = null

  function buildVao(
    state: WebGLBuffer,
    quad: WebGLBuffer,
  ): WebGLVertexArrayObject {
    const vao = gl.createVertexArray()
    if (!vao) throw new Error('webgl2: createVertexArray failed')
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.enableVertexAttribArray(aCorner)
    gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0)
    gl.vertexAttribDivisor(aCorner, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, state)
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, STRIDE, 0)
    gl.vertexAttribDivisor(aPos, 1)
    gl.enableVertexAttribArray(aColor)
    gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, STRIDE, 4 * 4)
    gl.vertexAttribDivisor(aColor, 1)
    gl.enableVertexAttribArray(aAlpha)
    gl.vertexAttribPointer(aAlpha, 1, gl.FLOAT, false, STRIDE, 7 * 4)
    gl.vertexAttribDivisor(aAlpha, 1)
    gl.bindVertexArray(null)
    return vao
  }

  return {
    setBuffers(state0, state1, quad): void {
      if (vaos) {
        gl.deleteVertexArray(vaos[0])
        gl.deleteVertexArray(vaos[1])
      }
      vaos = [buildVao(state0, quad), buildVao(state1, quad)]
    },
    use(read, count, u): void {
      if (count <= 0 || !vaos) return
      // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram is a WebGL method, not a React hook
      gl.useProgram(program)
      gl.bindVertexArray(vaos[read])

      gl.uniform1f(uDevW, u.devW)
      gl.uniform1f(uDevH, u.devH)
      gl.uniform1f(uDpr, u.dpr)
      gl.uniform1f(uDotSize, u.dotSize)

      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)
      gl.bindVertexArray(null)
    },
    dispose(): void {
      gl.deleteProgram(program)
      if (vaos) {
        gl.deleteVertexArray(vaos[0])
        gl.deleteVertexArray(vaos[1])
      }
    },
  }
}
