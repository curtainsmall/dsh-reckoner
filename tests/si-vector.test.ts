import { describe, expect, it } from 'vitest'
import { EngineError } from '../src/errors.ts'
import {
  SI_TABLE,
  ZERO_SI_VECTOR,
  addSiVectors,
  affineBackward,
  affineForward,
  allSiNames,
  dimSpecOfVector,
  formatSiVector,
  isIntegralSiVector,
  isZeroSiVector,
  kindOfSiVector,
  parseDim,
  scaleSiVector,
  siNameLookup,
  spellSiVector,
  subtractSiVectors,
} from '../src/engine/si-vector.ts'

function failureCode(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (error instanceof EngineError) return error.code
    throw error
  }
  throw new Error('expected the call to fail')
}

describe('the SI vector table', () => {
  it('holds the 24 documented rows with the zero vector first', () => {
    expect(SI_TABLE).toHaveLength(24)
    expect(SI_TABLE[0]?.vector).toEqual(ZERO_SI_VECTOR)
    expect(SI_TABLE[0]?.kind).toBe('dim-less')
    expect(SI_TABLE[0]?.names.map((entry) => entry.name)).toEqual(['dim-less', 'radian', 'steradian'])
  })

  it('labels the kind of each row and mentions its first name', () => {
    expect(kindOfSiVector([0, 0, 1, 0, 0, 0, 0])).toBe('time')
    expect(spellSiVector([0, 0, 1, 0, 0, 0, 0])).toBe('second')
    expect(kindOfSiVector([2, 1, -3, -2, 0, 0, 0])).toBe('resistance')
    expect(spellSiVector([2, 0, -2, 0, 0, 0, 0])).toBe('gray')
    expect(spellSiVector(ZERO_SI_VECTOR)).toBe('dim-less')
  })

  it('mentions a vector outside the table as its 7 integers', () => {
    expect(spellSiVector([1, 0, -1, 0, 0, 0, 0])).toBe('[1,0,-1,0,0,0,0]')
    expect(kindOfSiVector([1, 0, -1, 0, 0, 0, 0])).toBe('unnamed')
    expect(formatSiVector([1, 0, -1, 0, 0, 0, 0])).toBe('[1,0,-1,0,0,0,0]')
  })

  it('maps every name back to its own row', () => {
    for (const row of SI_TABLE) {
      for (const entry of row.names) {
        expect(siNameLookup(entry.name)?.row.vector).toEqual(row.vector)
      }
    }
    expect(allSiNames()).toContain('degC')
    expect(allSiNames()).toContain('katal')
    expect(allSiNames()).toHaveLength(SI_TABLE.reduce((total, row) => total + row.names.length, 0))
  })

  it('carries the affine map of degC and the identity of every other name', () => {
    expect(siNameLookup('degC')?.entry.offset).toBe(273.15)
    expect(siNameLookup('degC')?.entry.factor).toBe(1)
    expect(siNameLookup('kelvin')?.entry.offset).toBe(0)
  })
})

describe('dim parsing', () => {
  it('takes a table name, 7 integers, or nothing for the zero vector', () => {
    expect(parseDim('ampere', 'dim').vector).toEqual([0, 0, 0, 1, 0, 0, 0])
    expect(parseDim('degC', 'dim')).toEqual({
      vector: [0, 0, 0, 0, 1, 0, 0],
      name: 'degC',
      factor: 1,
      offset: 273.15,
    })
    expect(parseDim([1, 0, -1, 0, 0, 0, 0], 'dim').vector).toEqual([1, 0, -1, 0, 0, 0, 0])
    expect(parseDim(undefined, 'dim')).toEqual({ vector: ZERO_SI_VECTOR, factor: 1, offset: 0 })
    expect(parseDim(null, 'dim').vector).toEqual(ZERO_SI_VECTOR)
    expect(parseDim('dim-less', 'dim').name).toBe('dim-less')
  })

  it('refuses anything else with ENGINE_INVALID_DIMENSION and lists the names', () => {
    expect(failureCode(() => parseDim('bogus', 'dim'))).toBe('ENGINE_INVALID_DIMENSION')
    expect(failureCode(() => parseDim([1, 0, -1], 'dim'))).toBe('ENGINE_INVALID_DIMENSION')
    expect(failureCode(() => parseDim([1.5, 0, 0, 0, 0, 0, 0], 'dim'))).toBe('ENGINE_INVALID_DIMENSION')
    expect(failureCode(() => parseDim(5, 'dim'))).toBe('ENGINE_INVALID_DIMENSION')
    try {
      parseDim('bogus', 'dim')
    } catch (error) {
      expect((error as Error).message).toContain('ohm')
      expect((error as Error).message).toContain('m,kg,s,A,K,mol,cd')
    }
  })

  it('maps a name to its affine spelling', () => {
    expect(affineForward(25, parseDim('degC', 'dim'))).toBeCloseTo(298.15, 10)
    expect(affineBackward(298.15, parseDim('degC', 'dim'))).toBeCloseTo(25, 10)
    expect(dimSpecOfVector([2, 1, -3, -2, 0, 0, 0]).name).toBe('ohm')
    expect(dimSpecOfVector([1, 0, -1, 0, 0, 0, 0]).name).toBeUndefined()
  })
})

describe('vector arithmetic', () => {
  it('adds, subtracts and scales exponents', () => {
    expect(addSiVectors([2, 1, -3, -2, 0, 0, 0], [0, 0, 0, 1, 0, 0, 0])).toEqual([2, 1, -3, -1, 0, 0, 0])
    expect(subtractSiVectors([2, 1, -3, -1, 0, 0, 0], [2, 1, -3, -2, 0, 0, 0])).toEqual([0, 0, 0, 1, 0, 0, 0])
    expect(scaleSiVector([1, 0, 0, 0, 0, 0, 0], 0.5)).toEqual([0.5, 0, 0, 0, 0, 0, 0])
    expect(isZeroSiVector(subtractSiVectors([2, 1, -3, -2, 0, 0, 0], [2, 1, -3, -2, 0, 0, 0]))).toBe(true)
  })

  it('knows which vectors may land in a slot', () => {
    expect(isIntegralSiVector([2, 1, -3, -2, 0, 0, 0])).toBe(true)
    expect(isIntegralSiVector([0.5, 0, 0, 0, 0, 0, 0])).toBe(false)
  })
})
