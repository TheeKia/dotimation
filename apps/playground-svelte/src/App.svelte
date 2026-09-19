<script lang="ts">
  import { Dotimation, type DotimationStats } from '@kiaa/dotimation-svelte'
  import ContentControls from './components/ContentControls.svelte'
  import SimulationControls from './components/SimulationControls.svelte'
  import NumberField from './components/NumberField.svelte'
  import {
    defaults,
    loadConfig,
    snippet,
    STORAGE_KEY,
    toOptions
  } from './config'
  import './app.css'

  let config = $state(loadConfig())
  let stats = $state<DotimationStats>()
  let storageError = $state('')
  let copyStatus = $state('')
  const options = $derived(toOptions(config))
  const code = $derived(snippet(config))

  $effect(() => {
    const saved = JSON.stringify(config)
    const timeout = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, saved)
        storageError = ''
      } catch {
        storageError = 'Could not save settings. Browser storage may be full.'
      }
    }, 250)
    return () => clearTimeout(timeout)
  })
  function swap(): void {
    config.active = config.active === 'A' ? 'B' : 'A'
  }
  function keydown(event: KeyboardEvent): void {
    if (
      event.code !== 'Space' ||
      event.repeat ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return
    if (
      event.target instanceof Element &&
      event.target.closest(
        'input, textarea, select, button, summary, a, [contenteditable]'
      )
    )
      return
    event.preventDefault()
    swap()
  }
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code)
      copyStatus = 'Copied'
    } catch {
      copyStatus = 'Copy unavailable. Select the code below.'
    }
  }
</script>

<svelte:window onkeydown={keydown} />
<svelte:head
  ><title>Dotimation · Svelte playground</title><meta
    name="description"
    content="Explore text and image animations with Dotimation for Svelte."
  /></svelte:head
>
<main>
  <header>
    <div>
      <h1>Dotimation <span>/ Svelte</span></h1>
    </div>
    <button
      onclick={() => {
        config = defaults()
        copyStatus = ''
      }}>Reset all</button
    >
  </header>
  <div class="workspace">
    <aside aria-label="Animation controls">
      <section class="content-controls">
        <div class="section-heading">
          <h2>Content</h2>
          <div class="segmented">
            <button
              class:active={config.active === 'A'}
              aria-pressed={config.active === 'A'}
              onclick={() => {
                config.active = 'A'
              }}>Slot A</button
            ><button
              class:active={config.active === 'B'}
              aria-pressed={config.active === 'B'}
              onclick={() => {
                config.active = 'B'
              }}>Slot B</button
            >
          </div>
        </div>
        {#key config.active}<ContentControls
            bind:content={config.slots[config.active]}
          />{/key}
      </section>
      <details open>
        <summary>Canvas</summary>
        <div class="controls">
          <label
            >Canvas sizing<select
              aria-label="Canvas sizing"
              bind:value={config.sizing}
              ><option value="fill">Fill container</option><option value="fixed"
                >Fixed size</option
              ></select
            ></label
          >
          <label
            >Background<select
              aria-label="Background"
              bind:value={config.background}
              ><option value="dark">Dark</option><option value="light"
                >Light</option
              ><option value="checker">Checkerboard</option></select
            ></label
          >
        </div>
        {#if config.sizing === 'fixed'}
          <div class="pair controls">
            <NumberField
              label="Width"
              value={config.width}
              min={1}
              max={2048}
              change={(v) => {
                config.width = v ?? 640
              }}
            /><NumberField
              label="Height"
              value={config.height}
              min={1}
              max={2048}
              change={(v) => {
                config.height = v ?? 360
              }}
            />
          </div>
        {/if}
      </details>
      <SimulationControls bind:config />
    </aside>
    <section class="preview" aria-label="Preview">
      <div class="stage-scroll">
        <div
          class="stage {config.background}"
          class:fill={config.sizing === 'fill'}
          style:width={config.sizing === 'fixed'
            ? `${config.width}px`
            : undefined}
          style:height={config.sizing === 'fixed'
            ? `${config.height}px`
            : undefined}
        >
          <Dotimation
            {...options}
            onStats={(value) => {
              stats = value
            }}
          />
        </div>
      </div>
      <div class="preview-footer">
        <div class="status">
          <span data-testid="backend">{stats?.backend ?? 'Starting…'}</span
          ><span
            ><span data-testid="particles">{stats?.particles ?? 0}</span> particles</span
          ><span>Slot {config.active}</span>
        </div>
        <button class="swap" onclick={swap}
          >Morph to {config.active === 'A' ? 'B' : 'A'} <kbd>Space</kbd></button
        >
      </div>
      <details class="code-panel">
        <summary>Svelte code</summary><button onclick={copy}>Copy code</button
        ><span role="status">{copyStatus}</span>
        <pre><code>{code}</code></pre>
      </details>
      {#if storageError}<p role="status" class="error">{storageError}</p>{/if}
    </section>
  </div>
</main>
