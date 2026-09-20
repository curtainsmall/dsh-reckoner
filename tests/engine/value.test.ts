import { describe, expect, it } from 'vitest'
import { parseValueString } from '../../src/engine/parse-value.ts'
import { printValue } from '../../src/engine/print-value.ts'
import { validateValue } from '../../src/engine/values.ts'

/** Parse, and assert the result is a well-formed canonical value on the way out. */
function parse(source: string) {
  const value = parseValueString(source)
  expect(validateValue(value)).toBeUndefined()
  return value
}

describe('value parser: quantities', () => {
  it('reads a bare number as a plain count', () => {
    expect(parse('5')).toEqual({ type: 'number', value: 5, kind: 'none' })
    expect(parse('0.5')).toEqual({ type: 'number', value: 0.5, kind: 'none' })
    expect(parse('1e5')).toEqual({ type: 'number', value: 100000, kind: 'none' })
    expect(parse('1.5e-3')).toEqual({ type: 'number', value: 0.0015, kind: 'none' })
  })

  it('reads a unit word and folds it into SI with the kind', () => {
    expect(parse('4700ohm')).toEqual({ type: 'number', value: 4700, kind: 'resistance' })
    expect(parse('12volt')).toEqual({ type: 'number', value: 12, kind: 'voltage' })
    expect(parse('1.5second')).toEqual({ type: 'number', value: 1.5, kind: 'time' })
    expect(parse('50hertz')).toEqual({ type: 'number', value: 50, kind: 'frequency' })
  })

  it('refuses an abbreviated unit word (whole words only)', () => {
    expect(() => parse('12V')).toThrow(/is not a unit word/)
    expect(() => parse('1.5s')).toThrow(/is not a unit word/)
  })

  it('applies a one-letter prefix as a multiplier', () => {
    expect(parse('4.7kohm')).toEqual({ type: 'number', value: 4700, kind: 'resistance' })
    expect(parse('2.2Mohm')).toEqual({ type: 'number', value: 2200000, kind: 'resistance' })
    expect(parse('10mvolt')).toEqual({ type: 'number', value: 0.01, kind: 'voltage' })
    // 100 × 10^-6 is not exact in binary floating point; what matters is the magnitude.
    const micro = parse('100uohm')
    expect(micro).toMatchObject({ type: 'number', kind: 'resistance' })
    expect((micro as { value: number }).value).toBeCloseTo(0.0001, 15)
  })

  it('applies an affine variant: factor and offset', () => {
    expect(parse('25degC')).toEqual({ type: 'number', value: 298.15, kind: 'temperature' })
    expect(parse('0degC')).toEqual({ type: 'number', value: 273.15, kind: 'temperature' })
    expect(parse('10kdegC')).toEqual({ type: 'number', value: 10273.15, kind: 'temperature' })
    expect(parse('30deg')).toEqual({ type: 'number', value: (30 * Math.PI) / 180, kind: 'angle' })
  })

  it('treats three spellings of one quantity as one value', () => {
    expect(parse('4.7kohm')).toEqual(parse('4700ohm'))
    expect(parse('4.7kohm')).toEqual(parse('0.0047Mohm'))
  })
})

describe('value parser: complex', () => {
  it('reads an imaginary suffix and a rectangular literal', () => {
    expect(parse('2j')).toEqual({ type: 'complex', value: { re: 0, im: 2 }, kind: 'none' })
    expect(parse('4i')).toEqual({ type: 'complex', value: { re: 0, im: 4 }, kind: 'none' })
    expect(parse('3+4j')).toEqual({ type: 'complex', value: { re: 3, im: 4 }, kind: 'none' })
    expect(parse('3-4j')).toEqual({ type: 'complex', value: { re: 3, im: -4 }, kind: 'none' })
    expect(parse('j')).toEqual({ type: 'complex', value: { re: 0, im: 1 }, kind: 'none' })
  })
})

describe('value parser: structures', () => {
  it('reads arrays, objects and strings', () => {
    expect(parse('[100ohm, 220ohm]')).toEqual({
      type: 'array',
      value: [
        { type: 'number', value: 100, kind: 'resistance' },
        { type: 'number', value: 220, kind: 'resistance' },
      ],
    })
    expect(parse('{v: 12volt, note: "input"}')).toEqual({
      type: 'object',
      value: {
        v: { type: 'number', value: 12, kind: 'voltage' },
        note: { type: 'string', value: 'input' },
      },
    })
    expect(parse('"hello"')).toEqual({ type: 'string', value: 'hello' })
    expect(parse('[]')).toEqual({ type: 'array', value: [] })
    expect(parse('{}')).toEqual({ type: 'object', value: {} })
  })

  it('has no boolean: mathematics has no boolean type, so a bare word is refused', () => {
    expect(() => parse('true')).toThrow(/is not a value/)
    expect(() => parse('false')).toThrow(/is not a value/)
  })
})

describe('value parser: refusals carry a fix', () => {
  const cases: Array<[string, string, RegExp]> = [
    ['2e', 'ENGINE_PARSE_NUMBER', /must be followed by digits/],
    ['1E5', 'ENGINE_PARSE_NUMBER', /lowercase 'e'/],
    ['5m', 'ENGINE_PARSE_UNIT', /must be followed by a unit/],
    ['5k', 'ENGINE_PARSE_UNIT', /must be followed by a unit/],
    ['4.7kiloohm', 'ENGINE_PARSE_UNIT', /is not a unit word/],
    ['4.7kΩ', 'ENGINE_PARSE_SYNTAX', /is not allowed/],
    ['100 mH', 'ENGINE_PARSE_UNIT', /is not a unit word/],
    ['1R', 'ENGINE_PARSE_IDENT', /to multiply, write "\*"/],
    ['2x', 'ENGINE_PARSE_IDENT', /to multiply, write "\*"/],
    ['2*3', 'ENGINE_PARSE_SYNTAX', /never an arithmetic expression|unexpected/],
    ['1+', 'ENGINE_PARSE_SYNTAX', /ends where a number was expected/],
    ['[1,2', 'ENGINE_PARSE_SYNTAX', /missing its closing/],
    ['"unterminated', 'ENGINE_PARSE_SYNTAX', /unterminated string/],
    ['', 'ENGINE_PARSE_SYNTAX', /empty/],
  ]
  for (const [source, code, message] of cases) {
    it(`refuses ${JSON.stringify(source)}`, () => {
      try {
        parseValueString(source)
        throw new Error('expected a throw')
      } catch (error) {
        expect((error as { code?: string }).code).toBe(code)
        expect((error as Error).message).toMatch(message)
      }
    })
  }
})

describe('value printer', () => {
  it('prints the SI form by default, with the unit word', () => {
    expect(printValue(parse('4.7kohm'))).toBe('4700ohm')
    expect(printValue(parse('25degC'))).toBe('298.15kelvin')
    expect(printValue(parse('5'))).toBe('5')
  })

  it('prints in a requested unit or prefix and round-trips back', () => {
    const value = parse('4700ohm')
    expect(printValue(value, 'kohm')).toBe('4.7kohm')
    expect(parse(printValue(value, 'kohm'))).toEqual(value)
    expect(printValue(value, 'mohm')).toBe('4700000mohm')
    expect(parse(printValue(value, 'mohm'))).toEqual(value)
  })

  it('prints a variant and round-trips back', () => {
    const value = parse('25degC')
    expect(printValue(value, 'degC')).toBe('25degC')
    expect(parse(printValue(value, 'degC'))).toEqual(value)
    // 25 °C is 77 °F exactly; the factor is 5/9, so the printed form is rounded by `num`.
    expect(printValue(value, 'degF')).toBe('77degF')
  })

  it('prints complex in the rectangular unitless form, and polar on request', () => {
    const value = parse('3+4j')
    expect(printValue(value)).toBe('3+4j')
    expect(parse(printValue(value))).toEqual(value)
    expect(printValue(value, 'polar')).toBe('5∠0.927295218002')
  })

  it('prints an angle in degrees or radians, and round-trips both', () => {
    const value = parse('30deg')
    expect(printValue(value, 'deg')).toBe('30deg')
    expect(parse(printValue(value, 'deg'))).toEqual(value)
    // `rad` is the short spelling; the word it prints is the one the parser knows.
    expect(printValue(value, 'rad')).toBe('0.523598775598radian')
    // Printing keeps twelve significant digits, so the round-trip is close, not bit-exact.
    const back = parse(printValue(value, 'rad')) as { value: number; kind: string }
    expect(back.kind).toBe('angle')
    expect(back.value).toBeCloseTo(Math.PI / 6, 11)
  })
})

describe('value printer: refusals carry a fix', () => {
  it('refuses an unknown format and lists the vocabulary', () => {
    expect(() => printValue(parse('1ohm'), 'furlong')).toThrow(/unknown format/)
  })

  it('refuses a format whose kind differs from the value', () => {
    expect(() => printValue(parse('1ohm'), 'degC')).toThrow(/does not express resistance/)
  })
})
