import { describe, expect, it } from 'vitest'
import { ENGINE_ERROR_CODES, EngineError, fail, isEngineError } from '../src/errors.ts'

const DEAD_CODES = ['ENGINE_SLOT_KIND', 'ENGINE_TYPE_MIXED_KIND', 'ENGINE_UNSUPPORTED_VARIANT', 'ENGINE_NO_RECORD']

describe('the error code table', () => {
  it('holds exactly the 19 documented codes', () => {
    expect(ENGINE_ERROR_CODES).toHaveLength(19)
    expect(new Set(ENGINE_ERROR_CODES).size).toBe(19)
    expect([...ENGINE_ERROR_CODES]).toEqual([
      'ENGINE_PARSE_SYNTAX',
      'ENGINE_PARSE_NUMBER',
      'ENGINE_PARSE_IDENT',
      'ENGINE_PARSE_UNIT',
      'ENGINE_PARSE_SYMBOL',
      'ENGINE_PARSE_ARITY',
      'ENGINE_SLOT_UNDECLARED',
      'ENGINE_IDENT_UNBOUND',
      'ENGINE_DIM_MISMATCH',
      'ENGINE_TYPE_NOT_ARITHMETIC',
      'ENGINE_RANGE_INDEX',
      'ENGINE_RANGE_DOMAIN',
      'ENGINE_NOT_INDEXABLE',
      'ENGINE_NO_FIELD',
      'ENGINE_SYMBOL_NOT_EVALUABLE',
      'ENGINE_ARGS_INVALID',
      'ENGINE_NO_OPEN_RECORD',
      'ENGINE_RECORD_DUPLICATE',
      'ENGINE_TOOL',
    ])
  })

  it('carries no retired code', () => {
    for (const dead of DEAD_CODES) {
      expect(ENGINE_ERROR_CODES as readonly string[]).not.toContain(dead)
    }
  })

  it('prefixes every code with ENGINE_ and keeps it ASCII', () => {
    for (const code of ENGINE_ERROR_CODES) {
      expect(code.startsWith('ENGINE_')).toBe(true)
      expect(/^[\x20-\x7e]+$/.test(code)).toBe(true)
    }
  })
})

describe('EngineError', () => {
  it('carries the code and the message', () => {
    const error = new EngineError('ENGINE_NO_OPEN_RECORD', 'no record is open')
    expect(error.code).toBe('ENGINE_NO_OPEN_RECORD')
    expect(error.message).toBe('no record is open')
    expect(error).toBeInstanceOf(Error)
    expect(isEngineError(error)).toBe(true)
    expect(isEngineError(new Error('x'))).toBe(false)
  })

  it('is what fail throws', () => {
    expect(() => fail('ENGINE_TOOL', 'internal')).toThrowError(EngineError)
    try {
      fail('ENGINE_TOOL', 'internal')
    } catch (error) {
      expect(isEngineError(error) && error.code).toBe('ENGINE_TOOL')
    }
  })
})
