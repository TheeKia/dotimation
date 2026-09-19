import { IMAGE_DEFAULT, PRESETS, TEXT_DEFAULT } from '../../config/presets'
import type { ConfigApi } from '../../config/use-config'
import { ColorField } from '../controls/color-field'
import { Field } from '../controls/field'
import { NumberField } from '../controls/number-field'
import { Segmented } from '../controls/segmented'
import { Select } from '../controls/select'
import { Slider } from '../controls/slider'
import { TextArea } from '../controls/text-area'
import { TextField } from '../controls/text-field'
import { Toggle } from '../controls/toggle'

const FONT_FAMILIES = [
  { label: 'sans-serif', value: 'sans-serif' },
  { label: 'serif', value: 'serif' },
  { label: 'monospace', value: 'monospace' },
  { label: 'system-ui', value: 'system-ui' },
  { label: 'cursive', value: 'cursive' },
]

export function ContentControls({ api }: { api: ConfigApi }): React.ReactNode {
  const { config, update, setActiveItem, updateActiveItem } = api
  const item = config.slots[config.active]
  // Narrow, explicitly-typed mode so it matches the Segmented value type
  // (without this annotation, the numeric `fontSize` would widen the union).
  const fontSizeMode: 'AUTO' | 'AUTO_MONO' | 'Fixed' =
    item.type !== 'text'
      ? 'AUTO'
      : typeof item.fontSize === 'number'
        ? 'Fixed'
        : item.fontSize

  return (
    <>
      <Field label="slot">
        <Segmented
          value={config.active}
          options={[
            { label: 'A', value: 'A' },
            { label: 'B', value: 'B' },
          ]}
          onChange={(v) => update({ active: v })}
        />
      </Field>

      <div className="flex flex-wrap gap-1 py-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => setActiveItem(p.item)}
            className="rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground"
          >
            {p.label}
          </button>
        ))}
      </div>

      <Field label="type">
        <Segmented
          value={item.type}
          options={[
            { label: 'Text', value: 'text' },
            { label: 'Image', value: 'image' },
          ]}
          onChange={(v) =>
            setActiveItem(v === 'text' ? TEXT_DEFAULT : IMAGE_DEFAULT)
          }
        />
      </Field>

      {item.type === 'text' ? (
        <>
          <Field label="text">
            <TextArea
              value={item.data}
              onChange={(v) =>
                updateActiveItem((it) =>
                  it.type === 'text' ? { ...it, data: v } : it,
                )
              }
            />
          </Field>
          <Field label="font">
            <Select
              value={item.fontFamily}
              options={FONT_FAMILIES}
              onChange={(v) =>
                updateActiveItem((it) =>
                  it.type === 'text' ? { ...it, fontFamily: v } : it,
                )
              }
            />
          </Field>
          <Field label="size">
            <Segmented
              value={fontSizeMode}
              options={[
                { label: 'Auto', value: 'AUTO' },
                { label: 'Mono', value: 'AUTO_MONO' },
                { label: 'Fixed', value: 'Fixed' },
              ]}
              onChange={(m) =>
                updateActiveItem((it) =>
                  it.type === 'text'
                    ? { ...it, fontSize: m === 'Fixed' ? 36 : m }
                    : it,
                )
              }
            />
          </Field>
          {typeof item.fontSize === 'number' && (
            <Field label="px">
              <Slider
                value={item.fontSize}
                min={8}
                max={200}
                onChange={(v) =>
                  updateActiveItem((it) =>
                    it.type === 'text' ? { ...it, fontSize: v } : it,
                  )
                }
              />
            </Field>
          )}
          <Field label="color">
            <ColorField
              value={item.textColor}
              onChange={(v) =>
                updateActiveItem((it) =>
                  it.type === 'text' ? { ...it, textColor: v } : it,
                )
              }
            />
          </Field>
        </>
      ) : (
        <>
          <Field label="url">
            <TextField
              value={item.data}
              placeholder="https://…"
              onChange={(v) =>
                updateActiveItem((it) =>
                  it.type === 'image' ? { ...it, data: v } : it,
                )
              }
            />
          </Field>
          <Field label="maxW">
            <NumberField
              value={item.maxWidth}
              min={1}
              placeholder="auto"
              onChange={(v) =>
                updateActiveItem((it) =>
                  it.type === 'image' ? { ...it, maxWidth: v } : it,
                )
              }
            />
          </Field>
          <Field label="maxH">
            <NumberField
              value={item.maxHeight}
              min={1}
              placeholder="auto"
              onChange={(v) =>
                updateActiveItem((it) =>
                  it.type === 'image' ? { ...it, maxHeight: v } : it,
                )
              }
            />
          </Field>
          <Field label="invert">
            <Toggle
              checked={item.invert}
              onChange={(v) =>
                updateActiveItem((it) =>
                  it.type === 'image' ? { ...it, invert: v } : it,
                )
              }
            />
          </Field>
        </>
      )}
    </>
  )
}
