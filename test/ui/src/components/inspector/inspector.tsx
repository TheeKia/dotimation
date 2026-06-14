import type { ConfigApi } from '../../config/use-config'
import { BackendControls } from './backend-controls'
import { ContentControls } from './content-controls'
import { PerformanceControls } from './performance-controls'
import { RenderingControls } from './rendering-controls'
import { Section } from './section'

export function Inspector({ api }: { api: ConfigApi }): React.ReactNode {
  return (
    <aside className="w-[300px] shrink-0 overflow-y-auto border-r border-border bg-card/30">
      <Section title="Content">
        <ContentControls api={api} />
      </Section>
      <Section title="Rendering">
        <RenderingControls api={api} />
      </Section>
      <Section title="Backend">
        <BackendControls api={api} />
      </Section>
      <Section title="Performance">
        <PerformanceControls api={api} />
      </Section>
    </aside>
  )
}
