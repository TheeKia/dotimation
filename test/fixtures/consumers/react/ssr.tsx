import { Dotimation } from '@kiaa/dotimation-react'
import { renderToString } from 'react-dom/server'

export const html = renderToString(
  <Dotimation
    item={{ type: 'text', data: 'Packaged React' }}
    width={320}
    height={120}
    backend="canvas2d"
    reducedMotion
  />,
)
