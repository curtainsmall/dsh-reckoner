import { describe, expect, it } from 'vitest'
import { ENGINE_ERROR_CODES, EngineError, fail, isEngineError } from '../src/errors.ts'

const DEAD_CODES = ['ENGINE_SLOT_KIND', 'ENGINE_TYPE_MIXED_KIND', 'ENGINE_UNSUPPORTED_VARIANT', 'ENGINE_NO_RECORD']

describe('the error code table', () => {
  it('holds exactly the 19 documented codes', () => {
    expect(ENGINE_ERROR_CODES).toHaveLength(19)
    expect(new Set(ENGINE_ERROR_CODES).size).toBe(19)
    expect([...ENGINE_ERROR_CODES]).toEqual([
      'ENGINE_INVALID_FORMULA',
      'ENGINE_INVALID_NUMBER',
      'ENGINE_INVALID_IDENTIFIER',
      'ENGINE_INVALID_DIMENSION',
      'ENGINE_INVALID_NOTATION',
      'ENGINE_INVALID_ARITY',
      'ENGINE_SLOT_NOT_FOUND',
      'ENGINE_NAME_NOT_BOUND',
      'ENGINE_INCOMPATIBLE_DIMENSION',
      'ENGINE_UNSUPPORTED_OPERATION',
      'ENGINE_INVALID_INDEX',
      'ENGINE_UNDEFINED_RESULT',
      'ENGINE_UNSUPPORTED_INDEX',
      'ENGINE_FIELD_NOT_FOUND',
      'ENGINE_UNSUPPORTED_SYMBOL',
      'ENGINE_INVALID_ARGS',
      'ENGINE_OPEN_RECORD_NOT_FOUND',
      'ENGINE_OPEN_RECORD_FOUND',
      'ENGINE_UNKNOWN_ERROR',
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
    const error = new EngineError('ENGINE_OPEN_RECORD_NOT_FOUND', 'no record is open')
    expect(error.code).toBe('ENGINE_OPEN_RECORD_NOT_FOUND')
    expect(error.message).toBe('no record is open')
    expect(error).toBeInstanceOf(Error)
    expect(isEngineError(error)).toBe(true)
    expect(isEngineError(new Error('x'))).toBe(false)
  })

  it('is what fail throws', () => {
    expect(() => fail('ENGINE_UNKNOWN_ERROR', 'internal')).toThrowError(EngineError)
    try {
      fail('ENGINE_UNKNOWN_ERROR', 'internal')
    } catch (error) {
      expect(isEngineError(error) && error.code).toBe('ENGINE_UNKNOWN_ERROR')
    }
  })
})
