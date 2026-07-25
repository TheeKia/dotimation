import { describe, expect, test } from 'bun:test'
import { getAutoFontSize, getMonospaceFontSize } from '@/utils/font'

describe('getAutoFontSize', () => {
  test('clamps to the 10..300 range', () => {
    expect(getAutoFontSize(1, 'some long line of text')).toBe(10)
    expect(getAutoFontSize(1_000_000, 'hi')).toBe(300)
  })

  test('returns MIN for empty or invalid input', () => {
    expect(getAutoFontSize(500, '')).toBe(10)
    expect(getAutoFontSize(0, 'text')).toBe(10)
    expect(getAutoFontSize(Number.POSITIVE_INFINITY, 'text')).toBe(10)
  })

  test('longer lines get smaller fonts at the same width', () => {
    const short = getAutoFontSize(500, 'hello')
    const long = getAutoFontSize(500, 'hello world, a much longer line')
    expect(long).toBeLessThan(short)
  })

  test('uses the widest line of multiline text', () => {
    const multi = getAutoFontSize(500, 'hi\na considerably longer line here')
    const widest = getAutoFontSize(500, 'a considerably longer line here')
    expect(multi).toBe(widest)
  })

  test('wide glyphs (CJK) cost more than narrow ones', () => {
    expect(getAutoFontSize(500, '漢漢漢漢漢')).toBeLessThan(
      getAutoFontSize(500, 'lllll'),
    )
  })
})

describe('getMonospaceFontSize', () => {
  test('clamps to the 10..300 range', () => {
    expect(getMonospaceFontSize(1, 'long text here')).toBe(10)
    expect(getMonospaceFontSize(1_000_000, 'hi')).toBe(300)
  })

  test('returns MIN for empty input', () => {
    expect(getMonospaceFontSize(500, '')).toBe(10)
  })

  test('more characters get smaller fonts', () => {
    expect(getMonospaceFontSize(500, 'abcdefghij')).toBeLessThan(
      getMonospaceFontSize(500, 'abc'),
    )
  })
})
