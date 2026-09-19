import { Dotimation } from 'dotimation'
import { type ReactNode, StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'

function tree(text: string): ReactNode {
  return (
    <StrictMode>
      <Dotimation
        item={{ type: 'text', data: text }}
        width={320}
        height={120}
        backend="canvas2d"
        reducedMotion
      />
    </StrictMode>
  )
}
const target = document.getElementById('app')!
const hydrating = target.hasChildNodes()
const root = hydrating
  ? hydrateRoot(target, tree('Packaged React'))
  : createRoot(target)
const render = (text: string): void => root.render(tree(text))
Object.assign(window, { consumer: { render, unmount: () => root.unmount() } })
if (!hydrating) render('Packaged React')
