export function getGL(
  canvas: HTMLCanvasElement,
): WebGL2RenderingContext | null {
  return canvas.getContext('webgl2', {
    premultipliedAlpha: true,
    alpha: true,
    antialias: false,
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
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc)
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc)
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
  gl.deleteShader(vert)
  gl.deleteShader(frag)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`webgl2: program link failed: ${log}`)
  }
  return program
}
