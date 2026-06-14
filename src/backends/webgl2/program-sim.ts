import { STATE_FLOATS, TARGET_FLOATS } from '@/engine/reconcile-plan'
import { createProgram } from './gl'
import { SIM_VERT } from './shaders/sim.vert'

// Minimal passthrough fragment shader (sim never rasterizes).
const SIM_FRAG = `#version 300 es
precision highp float;
out vec4 c;
void main() { c = vec4(0.0); }
`

export interface SimUniforms {
  dt: number
  k: number
  c: number
  colorRate: number
  opacityRate: number
  jitter: number
  seed: number
}

export interface SimProgram {
  /**
   * (Re)bind the ping-pong state buffers and the shared targets buffer. Bakes
   * the attribute layout into one VAO per read index so `step` only swaps VAOs
   * instead of re-issuing every vertexAttribPointer. Call after the buffers are
   * created or grown.
   */
  setBuffers(
    state0: WebGLBuffer,
    state1: WebGLBuffer,
    targets: WebGLBuffer,
  ): void
  /** Advance the sim, reading state[read] (+targets) and writing state[read^1]. */
  step(read: 0 | 1, count: number, u: SimUniforms): void
  dispose(): void
}

const STATE_STRIDE = STATE_FLOATS * 4
const TARGET_STRIDE = TARGET_FLOATS * 4

export function createSimProgram(gl: WebGL2RenderingContext): SimProgram {
  const program = createProgram(gl, SIM_VERT, SIM_FRAG, [
    'vPos',
    'vVel',
    'vColor',
    'vAlpha',
  ])
  const loc = {
    aPos: gl.getAttribLocation(program, 'aPos'),
    aVel: gl.getAttribLocation(program, 'aVel'),
    aColor: gl.getAttribLocation(program, 'aColor'),
    aAlpha: gl.getAttribLocation(program, 'aAlpha'),
    aHomePos: gl.getAttribLocation(program, 'aHomePos'),
    aHomeColor: gl.getAttribLocation(program, 'aHomeColor'),
    aTargetAlpha: gl.getAttribLocation(program, 'aTargetAlpha'),
    uDt: gl.getUniformLocation(program, 'uDt'),
    uK: gl.getUniformLocation(program, 'uK'),
    uC: gl.getUniformLocation(program, 'uC'),
    uColorRate: gl.getUniformLocation(program, 'uColorRate'),
    uOpacityRate: gl.getUniformLocation(program, 'uOpacityRate'),
    uJitter: gl.getUniformLocation(program, 'uJitter'),
    uSeed: gl.getUniformLocation(program, 'uSeed'),
  }
  const tf = gl.createTransformFeedback()
  let vaos: [WebGLVertexArrayObject, WebGLVertexArrayObject] | null = null
  // The write buffer is a transform-feedback target (bound via bindBufferBase,
  // not part of the VAO), so it's tracked here to derive it from `read`.
  let states: [WebGLBuffer, WebGLBuffer] | null = null

  function buildVao(
    read: WebGLBuffer,
    targets: WebGLBuffer,
  ): WebGLVertexArrayObject {
    const vao = gl.createVertexArray()
    if (!vao) throw new Error('webgl2: createVertexArray failed')
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, read)
    gl.enableVertexAttribArray(loc.aPos)
    gl.vertexAttribPointer(loc.aPos, 2, gl.FLOAT, false, STATE_STRIDE, 0)
    gl.enableVertexAttribArray(loc.aVel)
    gl.vertexAttribPointer(loc.aVel, 2, gl.FLOAT, false, STATE_STRIDE, 2 * 4)
    gl.enableVertexAttribArray(loc.aColor)
    gl.vertexAttribPointer(loc.aColor, 3, gl.FLOAT, false, STATE_STRIDE, 4 * 4)
    gl.enableVertexAttribArray(loc.aAlpha)
    gl.vertexAttribPointer(loc.aAlpha, 1, gl.FLOAT, false, STATE_STRIDE, 7 * 4)
    gl.bindBuffer(gl.ARRAY_BUFFER, targets)
    gl.enableVertexAttribArray(loc.aHomePos)
    gl.vertexAttribPointer(loc.aHomePos, 2, gl.FLOAT, false, TARGET_STRIDE, 0)
    gl.enableVertexAttribArray(loc.aHomeColor)
    gl.vertexAttribPointer(
      loc.aHomeColor,
      3,
      gl.FLOAT,
      false,
      TARGET_STRIDE,
      2 * 4,
    )
    gl.enableVertexAttribArray(loc.aTargetAlpha)
    gl.vertexAttribPointer(
      loc.aTargetAlpha,
      1,
      gl.FLOAT,
      false,
      TARGET_STRIDE,
      5 * 4,
    )
    gl.bindVertexArray(null)
    return vao
  }

  return {
    setBuffers(state0, state1, targets): void {
      if (vaos) {
        gl.deleteVertexArray(vaos[0])
        gl.deleteVertexArray(vaos[1])
      }
      states = [state0, state1]
      vaos = [buildVao(state0, targets), buildVao(state1, targets)]
    },
    step(read, count, u): void {
      if (count <= 0 || !vaos || !states) return
      const write = states[(read ^ 1) as 0 | 1]
      // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram is a WebGL method, not a React hook
      gl.useProgram(program)
      gl.bindVertexArray(vaos[read])
      // The VAO already carries every attribute→buffer association, so clear
      // every non-transform-feedback binding that may still point at a state
      // buffer. A buffer can't be a TF output and bound elsewhere at the same
      // time, or the driver rejects glDrawArrays with GL_INVALID_OPERATION and
      // silently drops the sim write (frozen particles). uploadField's relocate
      // path leaves BOTH ping-pong buffers bound to COPY_READ_BUFFER/
      // COPY_WRITE_BUFFER (and ensureCapacity leaves one), so clear those too —
      // not just ARRAY_BUFFER left bound by uploadField/draw.
      gl.bindBuffer(gl.ARRAY_BUFFER, null)
      gl.bindBuffer(gl.COPY_READ_BUFFER, null)
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, null)

      gl.uniform1f(loc.uDt, u.dt)
      gl.uniform1f(loc.uK, u.k)
      gl.uniform1f(loc.uC, u.c)
      gl.uniform1f(loc.uColorRate, u.colorRate)
      gl.uniform1f(loc.uOpacityRate, u.opacityRate)
      gl.uniform1f(loc.uJitter, u.jitter)
      gl.uniform1f(loc.uSeed, u.seed)

      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf)
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, write)
      gl.enable(gl.RASTERIZER_DISCARD)
      gl.beginTransformFeedback(gl.POINTS)
      gl.drawArrays(gl.POINTS, 0, count)
      gl.endTransformFeedback()
      gl.disable(gl.RASTERIZER_DISCARD)
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null)
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null)
      gl.bindVertexArray(null)
    },
    dispose(): void {
      gl.deleteProgram(program)
      if (tf) gl.deleteTransformFeedback(tf)
      if (vaos) {
        gl.deleteVertexArray(vaos[0])
        gl.deleteVertexArray(vaos[1])
      }
    },
  }
}
