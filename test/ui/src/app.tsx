import './index.css'

import clsx from 'clsx'
import { type AnimateItem, Dotimation } from 'dotimation'
import { useState } from 'react'
import { useScreen } from './hooks/use-screen'

const TEST_ITEMS: { label: string; item: AnimateItem }[] = [
  {
    label: 'Auto Size',
    item: {
      type: 'text',
      data: 'Hello\nThis is a second line',
      fontSize: 'AUTO',
      fontFamily: 'sans-serif',
      textColor: 'rgb(255,0,255)',
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
      data: 'https://th-wave.s3.us-east-1.amazonaws.com/general/logo.svg',
    },
  },
  {
    label: 'Image (Inverted)',
    item: {
      type: 'image',
      data: 'https://th-wave.s3.us-east-1.amazonaws.com/general/logo.svg',
      invert: true,
    },
  },
] as const

export function App() {
  const [item, setItem] = useState<AnimateItem>(TEST_ITEMS[0].item)
  const screen = useScreen()

  return (
    <main className="flex size-screen pt-3">
      <Dotimation
        item={item}
        width={screen.width}
        height={screen.height - 48}
      />

      <div className="fixed bottom-2 inset-x-0 w-full flex items-center justify-center gap-1 h-7">
        {TEST_ITEMS.map(({ label, item: data }) => (
          <button
            key={label}
            type="button"
            onClick={() => setItem(data)}
            className={clsx(
              'cursor-pointer hover:bg-primary/10 px-2 h-7 rounded-md text-xs',
              data === item && 'bg-primary/10',
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </main>
  )
}

export default App
