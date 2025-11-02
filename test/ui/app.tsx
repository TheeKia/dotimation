import './styles.css'

import { useState } from 'react'
import { Dotimation } from '../../src'
import type { AnimateItem } from '../../src/types'

const TEST_ITEMS: { label: string; item: AnimateItem }[] = [
  {
    label: 'Auto Size',
    item: {
      type: 'text',
      data: 'Hello\nThis is a second line',
      fontSize: 'AUTO',
      fontFamily: 'sans-serif',
    },
  },
  {
    label: 'Auto Size (Short)',
    item: {
      type: 'text',
      data: 'Hello',
      fontSize: 'AUTO',
      fontFamily: 'sans-serif',
    },
  },
  {
    label: 'Auto Mono Size',
    item: {
      type: 'text',
      data: 'Hello\nThis is a second line',
      fontSize: 'AUTO_MONO',
      fontFamily: 'monospace',
    },
  },
  {
    label: 'Auto Mono Size (Short)',
    item: {
      type: 'text',
      data: 'Hello',
      fontSize: 'AUTO_MONO',
      fontFamily: 'monospace',
    },
  },
  {
    label: 'Fixed Size',
    item: {
      type: 'text',
      data: 'Hi',
      fontSize: 30,
    },
  },
  {
    label: 'Image',
    item: {
      type: 'image',
      data: 'https://th-wave.s3.us-east-1.amazonaws.com/users/CGRZsPszAMiO6teMTTuvl6fUKNnYODwD/logo/1762107543514.png',
    },
  },
]

export function App() {
  const [item, setItem] = useState<AnimateItem>(TEST_ITEMS[0]!.item)

  return (
    <main>
      <Dotimation item={item} width={512} height={512} />

      <div className="list">
        {TEST_ITEMS.map(({ label, item }) => (
          <button key={label} type="button" onClick={() => setItem(item)}>
            {label}
          </button>
        ))}
      </div>
    </main>
  )
}

export default App
