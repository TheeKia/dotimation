export interface GPUSetup {
  device: GPUDevice
  context: GPUCanvasContext
  format: GPUTextureFormat
}

/** Acquires a device and configures the canvas. Throws if WebGPU is unavailable. */
export async function acquireGPU(
  canvas: HTMLCanvasElement,
  cancelled: () => boolean = () => false,
): Promise<GPUSetup> {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    throw new Error('webgpu: navigator.gpu unavailable')
  }
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) throw new Error('webgpu: no adapter')
  if (cancelled()) throw new Error('webgpu: initialization cancelled')
  const device = await adapter.requestDevice()
  try {
    if (cancelled()) throw new Error('webgpu: initialization cancelled')
    const context = canvas.getContext('webgpu')
    if (!context) throw new Error('webgpu: no webgpu context')
    const format = navigator.gpu.getPreferredCanvasFormat()
    context.configure({ device, format, alphaMode: 'premultiplied' })
    return { device, context, format }
  } catch (error) {
    device.destroy()
    throw error
  }
}
