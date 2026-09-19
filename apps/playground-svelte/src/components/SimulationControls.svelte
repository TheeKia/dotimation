<script lang="ts">
  import type { Config } from '../config'
  import NumberField from './NumberField.svelte'
  let { config = $bindable() }: { config: Config } = $props()
</script>

<details open>
  <summary>Dots</summary>
  <div class="controls">
    <label class="toggle"
      ><input type="checkbox" bind:checked={config.hairline} /> Hairline (1 device
      pixel)</label
    >
    <div class="pair">
      <NumberField
        label="Dot size"
        value={config.size}
        min={0.25}
        max={8}
        step={0.25}
        disabled={config.hairline}
        change={(v) => {
          config.size = v ?? 1
        }}
      />
      <NumberField
        label="Spacing"
        value={config.spacing}
        min={1}
        max={16}
        step={0.5}
        change={(v) => {
          config.spacing = v ?? 2
        }}
      />
      <NumberField
        label="Alpha threshold"
        value={config.threshold}
        min={0}
        max={255}
        change={(v) => {
          config.threshold = v ?? 128
        }}
      />
      <NumberField
        label="Max particles"
        value={config.max}
        min={0}
        max={100000}
        step={100}
        optional
        change={(v) => {
          config.max = v
        }}
      />
    </div>
  </div>
</details>
<details open>
  <summary>Motion</summary>
  <div class="controls">
    <label
      >Motion preference<select
        aria-label="Motion preference"
        bind:value={config.reducedMotion}
        ><option value="auto">Follow system</option><option value="reduce"
          >Reduce motion</option
        ><option value="animate">Allow animation</option></select
      ></label
    >
    <label class="range-field"
      >Jitter <output>{config.jitter.toFixed(1)}</output><input
        aria-label="Jitter"
        type="range"
        min="0"
        max="5"
        step="0.1"
        bind:value={config.jitter}
      /></label
    >

    <div class="pair">
      <NumberField
        label="Settle time"
        value={config.settleTime}
        min={0.2}
        max={10}
        step={0.05}
        change={(v) => {
          config.settleTime = v ?? 0.85
        }}
      />
      <NumberField
        label="Damping"
        value={config.damping}
        min={0.3}
        max={1}
        step={0.05}
        change={(v) => {
          config.damping = v ?? 1
        }}
      />
      <NumberField
        label="Fade rate"
        value={config.fade}
        min={0.1}
        max={20}
        step={0.1}
        change={(v) => {
          config.fade = v ?? 2
        }}
      />
    </div>
    <label
      >Matching<select aria-label="Matching" bind:value={config.matching}
        ><option value="swarm">Swarm</option><option value="nearest"
          >Nearest</option
        ></select
      ></label
    >
  </div>
</details>
<details>
  <summary>Rendering</summary>
  <div class="controls">
    <label
      >Backend<select aria-label="Backend" bind:value={config.backend}
        ><option value="auto">Auto</option><option value="canvas2d"
          >Canvas 2D</option
        ><option value="webgl2">WebGL 2</option><option value="webgpu"
          >WebGPU</option
        ></select
      ></label
    >
    <NumberField
      label="DPR cap"
      value={config.maxDpr}
      min={0.5}
      max={4}
      step={0.5}
      change={(v) => {
        config.maxDpr = v ?? 2
      }}
    />
    <label
      >Default font family<input
        type="text"
        bind:value={config.defaultFontFamily}
      /></label
    >
  </div>
</details>
