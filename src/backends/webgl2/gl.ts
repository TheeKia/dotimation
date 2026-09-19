export function getGL(
  canvas: HTMLCanvasElement,
): WebGL2RenderingContext | null {
  return canvas.getContext('webgl2', {
    premultipliedAlpha: true,
    alpha: true,
    antialias: false,
    // The engine draws on every running frame, so nothing depends on the
    // drawing buffer surviving a present — and preserveDrawingBuffer forces
    // a copy on every present on many GPUs. When the loop sleeps, no present
    // happens and the browser keeps compositing the last presented frame.
    preserveDrawingBuffer: false,
  })
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('webgl2: createShader failed')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`webgl2: shader compile failed: ${log}`)
  }
  return shader
}

/**
 * Links a program from vertex+fragment sources. If `feedbackVaryings` is given,
 * configures transform-feedback capture (interleaved) before linking.
 */
export function createProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
  feedbackVaryings?: string[],
): WebGLProgram {
  const program = gl.createProgram()
  if (!program) throw new Error('webgl2: createProgram failed')
  let vert: WebGLShader | null = null
  let frag: WebGLShader | null = null
  try {
    vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc)
    frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc)
    gl.attachShader(program, vert)
    gl.attachShader(program, frag)
    if (feedbackVaryings) {
      gl.transformFeedbackVaryings(
        program,
        feedbackVaryings,
        gl.INTERLEAVED_ATTRIBS,
      )
    }
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(
        `webgl2: program link failed: ${gl.getProgramInfoLog(program)}`,
      )
    }
    return program
  } catch (error) {
    gl.deleteProgram(program)
    throw error
  } finally {
    if (vert) gl.deleteShader(vert)
    if (frag) gl.deleteShader(frag)
  }
}
