<script lang="ts">
  import { onDestroy } from 'svelte'
  import { imageContent, textContent, type Content } from '../config'
  import NumberField from './NumberField.svelte'

  let { content = $bindable() }: { content: Content } = $props()
  let error = $state('')
  let reader: FileReader | undefined
  onDestroy(() => reader?.abort())
  function upload(event: Event): void {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    reader?.abort()
    error = ''
    if (!file.type.startsWith('image/')) {
      error = 'Choose an image file.'
      input.value = ''
      return
    }
    const target = content
    const next = new FileReader()
    reader = next
    next.onload = () => {
      if (reader !== next || content !== target || content.type !== 'image')
        return
      content.data = String(next.result)
    }
    next.onerror = () => {
      if (reader === next) error = 'This image could not be read.'
    }
    next.readAsDataURL(file)
    input.value = ''
  }
</script>

<div class="segmented" aria-label="Content type">
  <button
    class:active={content.type === 'text'}
    aria-pressed={content.type === 'text'}
    onclick={() => {
      if (content.type !== 'text') content = textContent()
      error = ''
    }}>Text</button
  >
  <button
    class:active={content.type === 'image'}
    aria-pressed={content.type === 'image'}
    onclick={() => {
      if (content.type !== 'image') content = imageContent()
      error = ''
    }}>Image</button
  >
</div>
{#if content.type === 'text'}
  <label
    >Text<textarea rows="3" bind:value={content.data} spellcheck="false"
    ></textarea></label
  >
  <label
    >Font family<input
      type="text"
      bind:value={content.fontFamily}
      list="font-families"
    /></label
  >
  <datalist id="font-families"
    ><option value="sans-serif"></option><option value="serif"></option><option
      value="monospace"
    ></option><option value="system-ui"></option></datalist
  >
  <label
    >Font sizing<select
      aria-label="Font sizing"
      value={typeof content.fontSize === 'number' ? 'fixed' : content.fontSize}
      onchange={(event) => {
        if (content.type === 'text')
          content.fontSize =
            event.currentTarget.value === 'fixed'
              ? 48
              : (event.currentTarget.value as 'AUTO' | 'AUTO_MONO')
      }}
      ><option value="AUTO">Auto fit</option><option value="AUTO_MONO"
        >Monospace fit</option
      ><option value="fixed">Fixed size</option></select
    ></label
  >
  {#if typeof content.fontSize === 'number'}
    <NumberField
      label="Font size"
      value={content.fontSize}
      min={1}
      max={512}
      change={(value) => {
        if (content.type === 'text') content.fontSize = value ?? 48
      }}
    />
  {/if}
  <label class="color-field"
    >Text color<input type="color" bind:value={content.textColor} /></label
  >
{:else}
  <label
    >Image URL<input
      type="text"
      bind:value={content.data}
      placeholder="https://… or a data URL"
    /></label
  >
  <label class="upload"
    >Choose an image<input
      type="file"
      accept="image/*"
      onchange={upload}
    /></label
  >
  <p class="hint">
    Files stay in this browser. Use a CORS-enabled URL for remote images.
  </p>
  <div class="pair">
    <NumberField
      label="Image max width"
      value={content.maxWidth}
      min={1}
      max={4096}
      optional
      change={(value) => {
        if (content.type === 'image') content.maxWidth = value
      }}
    />
    <NumberField
      label="Image max height"
      value={content.maxHeight}
      min={1}
      max={4096}
      optional
      change={(value) => {
        if (content.type === 'image') content.maxHeight = value
      }}
    />
  </div>
  <label class="toggle"
    ><input type="checkbox" bind:checked={content.invert} /> Invert colors</label
  >
{/if}
{#if error}<p role="alert" class="error">{error}</p>{/if}
