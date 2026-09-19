<script lang="ts">
  let {
    label,
    value,
    min,
    max,
    step = 1,
    optional = false,
    disabled = false,
    change
  }: {
    label: string
    value: number | undefined
    min: number
    max: number
    step?: number
    optional?: boolean
    disabled?: boolean
    change: (value: number | undefined) => void
  } = $props()
  function update(event: Event): void {
    const input = event.currentTarget as HTMLInputElement
    if (input.value === '' && optional) {
      change(undefined)
      return
    }
    const next = input.valueAsNumber
    if (Number.isFinite(next)) change(Math.min(max, Math.max(min, next)))
  }
</script>

<label class="number-field">
  <span>{label}</span>
  <input
    type="number"
    {value}
    {min}
    {max}
    {step}
    {disabled}
    placeholder={optional ? 'Unlimited' : undefined}
    oninput={update}
    onblur={(event) => {
      event.currentTarget.value = value === undefined ? '' : String(value)
    }}
  />
</label>
