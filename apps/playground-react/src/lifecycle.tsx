import { Dotimation } from 'dotimation'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { gpuChecks } from '../../../test/fixtures/browser/gpu'
import type { LifecycleProps } from '../../../test/fixtures/browser/lifecycle'

type Props = LifecycleProps
const host = document.getElementById('root')!
const root = createRoot(host)
let props: Props = {
  item: { type: 'text', data: 'Lifecycle' },
  fill: true,
  backend: 'canvas2d',
  motion: { jitter: 0 },
}

window.lifecycle = {
  stats: null,
  updates: 0,
  element: null,
  render(next) {
    props = { ...props, ...next } as Props
    root.render(
      <StrictMode>
        <Dotimation
          {...props}
          ref={(canvas) => {
            window.lifecycle.element = canvas
          }}
          onStats={(stats) => {
            window.lifecycle.updates++
            window.lifecycle.stats = stats
          }}
        />
      </StrictMode>,
    )
  },
  mutateContent(text) {
    props.item.data = text
    window.lifecycle.render({})
  },
  resize(width, height) {
    host.style.width = `${width}px`
    host.style.height = `${height}px`
  },
  ...gpuChecks,
  unmount() {
    root.unmount()
  },
}
window.lifecycle.render({})
