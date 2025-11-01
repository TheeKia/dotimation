// Scales by text content so wider glyphs (W,M,0-9, emoji, CJK) cost more.
function getFontSize(width: number, text: string): number {
  const MAX = 300
  const MIN = 10

  if (!text || width <= 0) return MIN
  if (!Number.isFinite(width)) return MIN

  // Average per-glyph "em" costs (relative to 1em width).
  const WEIGHTS = {
    LIGHT: 0.54, // a–z
    HEAVY: 0.78, // W/M
    UPPER_NUM: 0.66, // A–Z and 0–9
    SPACE: 0.3, // space
    PUNCT: 0.38, // .,:;!?-_"'`/\
    CJK: 1.0, // CJK full-width
    EMOJI: 1.1, // Emoji
    AVG: 0.6, // fallback
  } as const

  const PUNCT_REGEX = /[.,;:!?'"`\-_/\\]/

  let emTotal = 0
  let charCount = 0

  for (const ch of text) {
    const cp = ch.codePointAt(0)
    if (cp === undefined) continue

    charCount++

    if (cp <= 0x7f) {
      // Basic Latin (ASCII)
      if (ch === ' ') {
        emTotal += WEIGHTS.SPACE
      } else if (PUNCT_REGEX.test(ch)) {
        emTotal += WEIGHTS.PUNCT
      } else if (ch === 'M' || ch === 'W') {
        emTotal += WEIGHTS.HEAVY
      } else if (cp >= 0x41 && cp <= 0x5a) {
        emTotal += WEIGHTS.UPPER_NUM
      } else if (cp >= 0x30 && cp <= 0x39) {
        emTotal += WEIGHTS.UPPER_NUM
      } else if (cp >= 0x61 && cp <= 0x7a) {
        emTotal += WEIGHTS.LIGHT
      } else {
        emTotal += WEIGHTS.AVG
      }
    } else {
      // Unicode beyond ASCII
      if (isEmoji(cp)) {
        emTotal += WEIGHTS.EMOJI
      } else if (isCJK(cp)) {
        emTotal += WEIGHTS.CJK
      } else {
        emTotal += WEIGHTS.AVG
      }
    }
  }

  if (charCount === 0 || emTotal === 0) return MIN

  // For very short text, add padding to prevent oversizing
  const paddingFactor = Math.max(1, 6 - charCount) * 0.15
  const effectiveEmTotal = emTotal * (1 + paddingFactor)

  let fontSize = width / effectiveEmTotal

  fontSize = Math.max(MIN, Math.min(fontSize, MAX))

  if (!Number.isFinite(fontSize)) return MIN

  return fontSize
}

// Helper: Comprehensive emoji detection
function isEmoji(cp: number): boolean {
  return (
    (cp >= 0x1f300 && cp <= 0x1f9ff) || // Misc Symbols and Pictographs, Emoticons, Transport, etc.
    (cp >= 0x1fa00 && cp <= 0x1faff) || // Extended Pictographs
    (cp >= 0x2600 && cp <= 0x26ff) || // Misc symbols
    (cp >= 0x2700 && cp <= 0x27bf) || // Dingbats
    (cp >= 0x1f000 && cp <= 0x1f02f) || // Mahjong, Domino tiles
    (cp >= 0x1f0a0 && cp <= 0x1f0ff) || // Playing cards
    (cp >= 0xfe00 && cp <= 0xfe0f) || // Variation selectors
    (cp >= 0x1f900 && cp <= 0x1f9ff) || // Supplemental Symbols
    (cp >= 0x1fa70 && cp <= 0x1faff) // Extended-A
  )
}

// Helper: CJK character detection
function isCJK(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Extension A
    (cp >= 0x20000 && cp <= 0x2a6df) || // CJK Extension B
    (cp >= 0x3040 && cp <= 0x309f) || // Hiragana
    (cp >= 0x30a0 && cp <= 0x30ff) || // Katakana
    (cp >= 0xac00 && cp <= 0xd7af) || // Hangul Syllables
    (cp >= 0x1100 && cp <= 0x11ff) // Hangul Jamo
  )
}

export function getAutoFontSize(width: number, text: string): number {
  const lines = text.split('\n')
  return lines.reduce((acc, line) => {
    const size = getFontSize(width, line)
    return size < acc ? size : acc
  }, Infinity)
}

export function getMonospaceFontSize(width: number, text: string): number {
  const MAX = 300
  const MIN = 10

  if (!text || width <= 0) return MIN

  const glyphCount = text
    .split('\n')
    .reduce((acc, line) => (line.length > acc ? line.length : acc), 0)
  if (glyphCount === 0) return MIN

  // For monospace: each character occupies ~0.6em width (typical for most mono fonts)
  const MONO_CHAR_WIDTH = 0.65
  const totalEmWidth = glyphCount * MONO_CHAR_WIDTH

  const directSize = width / totalEmWidth

  // Soft lower bound for very short text to avoid giant letters
  // Uses a gentler curve for 1-4 characters
  const softSize = Math.sqrt(width * 8) + Math.log1p(width * 2)

  // Blend: trust direct calculation more as text gets longer
  const blendFactor = Math.min(glyphCount / 5, 1)
  const blendedSize = directSize * blendFactor + softSize * (1 - blendFactor)

  return Math.max(MIN, Math.min(blendedSize, MAX))
}
