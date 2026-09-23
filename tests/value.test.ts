import { describe, expect, it } from 'vitest'
import { EngineError, EngineErrorCode } from '../src/errors.ts'
import {
  assertIntegralValue,
  assertValueDim,
  mentionDim,
  parseSetValue,
  renderValue,
  roundSignificant,
  storedDimSpelling,
  type Value,
} from '../src/engine/value.ts'
import { parseDim, ZERO_SI_VECTOR } from '../src/engine/si-vector.ts'

function failureCode(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (error instanceof EngineError) return error.code
    throw error
  }
  throw new Error('expected the call to fail')
}

function failureMessage(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (error instanceof EngineError) return error.message
    throw error
  }
  throw new Error('expected the call to fail')
}

const OHM = [2, 1, -3, -2, 0, 0, 0] as const

describe('the set value structure', () => {
  it('reads a real with its dim', () => {
    const value = parseSetValue({ num: 4.7e3, dim: 'ohm' })
    expect(value).toEqual({ kind: 'number', num: 4700, dim: OHM })
  })

  it('defaults the dimension to the zero vector', () => {
    expect(parseSetValue({ num: 3 })).toEqual({ kind: 'number', num: 3, dim: ZERO_SI_VECTOR })
  })

  it('applies the affine map of the spelled dim, to the real part only', () => {
    expect(parseSetValue({ num: 25, dim: 'degC' })).toEqual({ kind: 'number', num: 298.15, dim: [0, 0, 0, 0, 1, 0, 0] })
    const complex = parseSetValue({ re: 25, im: 2, dim: 'degC' })
    expect(complex.kind).toBe('complex')
    if (complex.kind !== 'complex') return
    expect(complex.re).toBeCloseTo(298.15, 10)
    expect(complex.im).toBe(2)
  })

  it('applies the same affine map to an array element, which carries the array dim', () => {
    const value = parseSetValue({ array: [25, { re: 30, im: 1 }, [40]], dim: 'degC' })
    expect(value.kind).toBe('array')
    if (value.kind !== 'array') return
    expect(value.dim).toEqual([0, 0, 0, 0, 1, 0, 0])
    expect(value.items[0]).toEqual({ kind: 'number', num: 298.15, dim: [0, 0, 0, 0, 1, 0, 0] })
    const complex = value.items[1]
    expect(complex?.kind).toBe('complex')
    if (complex?.kind !== 'complex') return
    expect(complex.re).toBeCloseTo(303.15, 10)
    expect(complex.im).toBe(1)
    const nested = value.items[2]
    expect(nested?.kind).toBe('array')
    if (nested?.kind !== 'array') return
    expect(nested.items[0]).toEqual({ kind: 'number', num: 313.15, dim: [0, 0, 0, 0, 1, 0, 0] })
  })

  it('converts a polar complex to rectangular on the way in', () => {
    const value = parseSetValue({ mag: 5, ang: Math.atan2(4, 3), dim: 'ohm' })
    expect(value.kind).toBe('complex')
    if (value.kind !== 'complex') return
    expect(value.re).toBeCloseTo(3, 10)
    expect(value.im).toBeCloseTo(4, 10)
    expect(value.dim).toEqual(OHM)
  })

  it('reads an array of bare elements sharing the outer dim', () => {
    const value = parseSetValue({ array: [100, { re: 1, im: 2 }, [3, 4]], dim: 'ohm' })
    expect(value.kind).toBe('array')
    if (value.kind !== 'array') return
    expect(value.dim).toEqual(OHM)
    expect(value.items[0]).toEqual({ kind: 'number', num: 100, dim: OHM })
    expect(value.items[2]).toEqual({
      kind: 'array',
      items: [
        { kind: 'number', num: 3, dim: OHM },
        { kind: 'number', num: 4, dim: OHM },
      ],
      dim: OHM,
    })
  })

  it('reads an object field by field, each with its own dim', () => {
    const value = parseSetValue({ object: { v: { num: 12, dim: 'volt' }, i: { num: 2, dim: 'ampere' } } })
    expect(value.kind).toBe('object')
    if (value.kind !== 'object') return
    expect(value.fields['v']).toEqual({ kind: 'number', num: 12, dim: [2, 1, -3, -1, 0, 0, 0] })
    expect(value.fields['i']).toEqual({ kind: 'number', num: 2, dim: [0, 0, 0, 1, 0, 0, 0] })
  })

  it('refuses a tag combination that is not exactly one complete tag', () => {
    expect(failureCode(() => parseSetValue({ num: 1, re: 2, im: 3 }))).toBe(EngineErrorCode.InvalidArgs)
    expect(failureCode(() => parseSetValue({ num: 1, array: [1] }))).toBe(EngineErrorCode.InvalidArgs)
    expect(failureCode(() => parseSetValue({ re: 2 }))).toBe(EngineErrorCode.InvalidArgs)
    expect(failureCode(() => parseSetValue({ mag: 2 }))).toBe(EngineErrorCode.InvalidArgs)
    expect(failureCode(() => parseSetValue({}))).toBe(EngineErrorCode.InvalidArgs)
    expect(failureCode(() => parseSetValue([1, 2]))).toBe(EngineErrorCode.InvalidArgs)
    expect(failureCode(() => parseSetValue(null))).toBe(EngineErrorCode.InvalidArgs)
  })

  it('refuses a dim on an object, an unknown key, a tagged array element and a non-number', () => {
    expect(failureCode(() => parseSetValue({ object: { a: { num: 1 } }, dim: 'ohm' }))).toBe(EngineErrorCode.InvalidArgs)
    expect(failureCode(() => parseSetValue({ num: 1, kind: 'ohm' }))).toBe(EngineErrorCode.InvalidArgs)
    expect(failureCode(() => parseSetValue({ array: [{ num: 1 }] }))).toBe(EngineErrorCode.InvalidArgs)
    expect(failureCode(() => parseSetValue({ num: '1' }))).toBe(EngineErrorCode.InvalidArgs)
    expect(failureCode(() => parseSetValue({ num: 1, dim: 'bogus' }))).toBe(EngineErrorCode.InvalidDimension)
    expect(failureCode(() => parseSetValue({ object: { '1x': { num: 1 } } }))).toBe(EngineErrorCode.InvalidIdentifier)
  })
})

describe('receipt rendering', () => {
  it('echoes a stored fact with the dim as 7 integers', () => {
    expect(renderValue(parseSetValue({ num: 4.7e3, dim: 'ohm' }), { spellDim: storedDimSpelling })).toEqual({
      num: 4700,
      dim: [2, 1, -3, -2, 0, 0, 0],
    })
  })

  it('echoes a complex rectangular in the stored form', () => {
    const value = parseSetValue({ mag: 5, ang: Math.atan2(4, 3), dim: 'ohm' })
    const rendered = renderValue(value, { spellDim: storedDimSpelling }) as { re: number; im: number; dim: unknown }
    expect(rendered.re).toBeCloseTo(3, 10)
    expect(rendered.im).toBeCloseTo(4, 10)
    expect(rendered.dim).toEqual([2, 1, -3, -2, 0, 0, 0])
  })

  it('reads a real in the requested form and widens it to a complex', () => {
    const value = parseSetValue({ num: 4700, dim: 'ohm' })
    expect(renderValue(value, { form: 'rect', spellDim: mentionDim })).toEqual({ re: 4700, im: 0, dim: 'ohm' })
    expect(renderValue(value, { form: 'polar', spellDim: mentionDim })).toEqual({ mag: 4700, ang: 0, dim: 'ohm' })
    const negative = parseSetValue({ num: -3 })
    expect(renderValue(negative, { form: 'polar', spellDim: mentionDim })).toEqual({ mag: 3, ang: Math.PI, dim: 'dim-less' })
  })

  it('converts a complex to polar on the way out', () => {
    const value = parseSetValue({ re: 3, im: 4, dim: 'ohm' })
    const rendered = renderValue(value, { form: 'polar', spellDim: mentionDim }) as { mag: number; ang: number; dim: string }
    expect(rendered.mag).toBe(5)
    expect(rendered.ang).toBeCloseTo(Math.atan2(4, 3), 12)
    expect(rendered.dim).toBe('ohm')
  })

  it('keeps the stored form when no form is asked for', () => {
    expect(renderValue(parseSetValue({ re: 3, im: 0, dim: 'ohm' }), { spellDim: mentionDim })).toEqual({
      re: 3,
      im: 0,
      dim: 'ohm',
    })
    expect(renderValue(parseSetValue({ num: 3, dim: 'ohm' }), { spellDim: mentionDim })).toEqual({ num: 3, dim: 'ohm' })
  })

  it('rounds to at most the requested significant digits, never padding', () => {
    const value = parseSetValue({ num: 4700, dim: 'ohm' })
    expect(renderValue(value, { digits: 4, spellDim: mentionDim })).toEqual({ num: 4700, dim: 'ohm' })
    expect(renderValue(parseSetValue({ num: 123456 }), { digits: 3, spellDim: mentionDim })).toEqual({ num: 123000, dim: 'dim-less' })
    expect(renderValue(parseSetValue({ num: 4700 }), { digits: 9, spellDim: mentionDim })).toEqual({ num: 4700, dim: 'dim-less' })
    expect(roundSignificant(0.00034251, 4)).toBeCloseTo(0.0003425, 12)
    expect(roundSignificant(0, 4)).toBe(0)
  })

  it('converts the leaves through the requested spelling', () => {
    const spec = parseDim('degC', 'dim')
    const value = parseSetValue({ num: 298.15, dim: 'kelvin' })
    const rendered = renderValue(value, { scale: spec, spellDim: () => 'degC' }) as { num: number; dim: string }
    expect(rendered.num).toBeCloseTo(25, 10)
    expect(rendered.dim).toBe('degC')
  })

  it('renders an array with one dim and an object field by field', () => {
    expect(renderValue(parseSetValue({ array: [1, 2], dim: 'volt' }), { spellDim: storedDimSpelling })).toEqual({
      array: [1, 2],
      dim: [2, 1, -3, -1, 0, 0, 0],
    })
    expect(renderValue(parseSetValue({ object: { a: { num: 1, dim: 'volt' } } }), { spellDim: storedDimSpelling })).toEqual({
      object: { a: { num: 1, dim: [2, 1, -3, -1, 0, 0, 0] } },
    })
  })
})

describe('claims about a stored value', () => {
  const value: Value = parseSetValue({ num: 4700, dim: 'ohm' })

  it('accepts the vector it holds and refuses another one', () => {
    expect(() => assertValueDim(value, parseDim('ohm', 'dim'), 'the slot "R1"')).not.toThrow()
    expect(failureCode(() => assertValueDim(value, parseDim('volt', 'dim'), 'the slot "R1"'))).toBe(EngineErrorCode.IncompatibleDimension)
    expect(failureMessage(() => assertValueDim(value, parseDim('volt', 'dim'), 'the slot "R1"'))).toContain('ohm')
  })

  it('checks an object per field and names the field that does not match', () => {
    const object = parseSetValue({ object: { v: { num: 12, dim: 'volt' }, r: { num: 2, dim: 'ohm' } } })
    const message = failureMessage(() => assertValueDim(object, parseDim('ohm', 'dim'), 'the slot "net"'))
    expect(message).toContain('field "v"')
  })

  it('refuses a fractional SI vector on the way into a slot', () => {
    const fractional: Value = { kind: 'number', num: 2, dim: [0.5, 0, 0, 0, 0, 0, 0] }
    expect(failureCode(() => assertIntegralValue(fractional, 'the slot "x"'))).toBe(EngineErrorCode.IncompatibleDimension)
    expect(() => assertIntegralValue(value, 'the slot "R1"')).not.toThrow()
  })
})
