import { afterEach, expect, mock, test } from 'bun:test'
import { acquireGPU } from '../../../src/backends/webgpu/device'

const descriptor = Object.getOwnPropertyDescriptor(navigator, 'gpu')
afterEach(() => {
  if (descriptor) Object.defineProperty(navigator, 'gpu', descriptor)
  else Reflect.deleteProperty(navigator, 'gpu')
})

function setup() {
  const destroy = mock(() => {})
  const requestDevice = mock(async () => ({ destroy }))
  Object.defineProperty(navigator, 'gpu', {
    configurable: true,
    value: {
      requestAdapter: async () => ({ requestDevice }),
      getPreferredCanvasFormat: () => 'bgra8unorm',
    },
  })
  return { destroy, requestDevice }
}

test('device is released when canvas configuration fails', async () => {
  const { destroy } = setup()
  const canvas = {
    getContext: () => ({
      configure() {
        throw new Error('configure failed')
      },
    }),
  } as unknown as HTMLCanvasElement
  await expect(acquireGPU(canvas)).rejects.toThrow('configure failed')
  expect(destroy).toHaveBeenCalledTimes(1)
})

test('a cancelled adapter request never acquires a device or binds the canvas', async () => {
  const { requestDevice } = setup()
  const getContext = mock(() => null)
  await expect(
    acquireGPU({ getContext } as unknown as HTMLCanvasElement, () => true),
  ).rejects.toThrow('cancelled')
  expect(requestDevice).not.toHaveBeenCalled()
  expect(getContext).not.toHaveBeenCalled()
})

test('a device arriving after cancellation is destroyed before binding the canvas', async () => {
  const { destroy } = setup()
  let checks = 0
  const getContext = mock(() => null)
  await expect(
    acquireGPU(
      { getContext } as unknown as HTMLCanvasElement,
      () => ++checks > 1,
    ),
  ).rejects.toThrow('cancelled')
  expect(destroy).toHaveBeenCalledTimes(1)
  expect(getContext).not.toHaveBeenCalled()
})
