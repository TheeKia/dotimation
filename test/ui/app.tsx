import './styles.css'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Dotimation } from '../../src'

const queryClient = new QueryClient()

export function App() {
  return (
    <main>
      <QueryClientProvider client={queryClient}>
        <Dotimation
          item={{ type: 'text', data: 'Hello' }}
          width={256}
          height={256}
        />
      </QueryClientProvider>
    </main>
  )
}

export default App
