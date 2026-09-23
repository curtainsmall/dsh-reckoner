import { describe, expect, it } from 'vitest'
import { EngineError } from '../src/errors.ts'
import { evaluateFormula } from '../src/engine/formula-eval.ts'
import { parseFormula } from '../src/engine/formula-parser.ts'
import { parseSetValue, type Value } from '../src/engine/value.ts'

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

function run(formula: string, slots: Record<string, Value> = {}): Value {
  return evaluateFormula(parseFormula(formula), { read: (name) => slots[name], note: () => {} })
}

function number(formula: string, slots: Record<string, Value> = {}): number {
  const value = run(formula, slots)
  if (value.kind === 'number') return value.num
  if (value.kind === 'complex') {
    expect(value.im).toBe(0)
    return value.re
  }
  throw new Error(`the formula "${formula}" did not produce a scalar`)
}

function dim(formula: string, slots: Record<string, Value> = {}): readonly number[] {
  const value = run(formula, slots)
  if (value.kind === 'object') throw new Error('an object has one dim per field')
  return value.dim
}

const OHM = parseSetValue({ num: 4700, dim: 'ohm' })
const R2 = parseSetValue({ num: 220, dim: 'ohm' })
const V_IN = parseSetValue({ num: 12, dim: 'volt' })
const LENGTH = parseSetValue({ num: 8, dim: 'metre' })
const NET = parseSetValue({ num: 2, dim: 'second' })

describe('scalar literals', () => {
  it('reads integers, decimals and the lowercase scientific form', () => {
    expect(number('42')).toBe(42)
    expect(number('1.5')).toBe(1.5)
    expect(number('1e5')).toBe(100000)
    expect(number('1e-2')).toBe(0.01)
  })

  it('reads the imaginary suffixes and $j', () => {
    const literal = run('2j')
    expect(literal.kind).toBe('complex')
    if (literal.kind !== 'complex') return
    expect(literal.re).toBe(0)
    expect(literal.im).toBe(2)
    const fromConstant = run('2*$j')
    expect(fromConstant.kind).toBe('complex')
    if (fromConstant.kind !== 'complex') return
    expect(fromConstant.im).toBe(2)
  })

  it('refuses a broken number, a trailing letter and an uppercase exponent', () => {
    expect(failureCode(() => run('2e'))).toBe('ENGINE_INVALID_NUMBER')
    expect(failureCode(() => run('1E5'))).toBe('ENGINE_INVALID_IDENTIFIER')
    expect(failureMessage(() => run('2x'))).toContain('2*x')
    expect(failureCode(() => run('2jx'))).toBe('ENGINE_INVALID_IDENTIFIER')
  })

  it('refuses anything outside the charset', () => {
    expect(failureCode(() => run('"1"'))).toBe('ENGINE_INVALID_FORMULA')
    expect(failureCode(() => run('1+2;'))).toBe('ENGINE_INVALID_FORMULA')
    expect(failureCode(() => run('2\u00d73'))).toBe('ENGINE_INVALID_FORMULA')
    expect(failureCode(() => run('1 + 2 3'))).toBe('ENGINE_INVALID_FORMULA')
  })
})

describe('operators and precedence', () => {
  it('follows additive before multiplicative and unary before power', () => {
    expect(number('2+3*4')).toBe(14)
    expect(number('(2+3)*4')).toBe(20)
    expect(number('-2^2')).toBe(-4)
    expect(number('2^3^2')).toBe(512)
    expect(number('2^-1')).toBe(0.5)
    expect(number('10-2-3')).toBe(5)
  })

  it('needs multiplication written', () => {
    expect(failureCode(() => run('2@R', { R: OHM }))).toBe('ENGINE_INVALID_FORMULA')
    expect(number('2*@R', { R: OHM })).toBe(9400)
  })

  it('divides by zero only in the domain code', () => {
    expect(failureCode(() => run('1/0'))).toBe('ENGINE_UNDEFINED_RESULT')
    expect(number('0^0')).toBe(1)
    expect(failureCode(() => run('0^-1'))).toBe('ENGINE_UNDEFINED_RESULT')
  })
})

describe('slots and bound variables', () => {
  it('reads a declared slot and refuses an undeclared one', () => {
    expect(number('@R', { R: OHM })).toBe(4700)
    expect(failureCode(() => run('@nope'))).toBe('ENGINE_SLOT_NOT_FOUND')
  })

  it('treats a bare name as a bound variable only', () => {
    expect(failureCode(() => run('R', { R: OHM }))).toBe('ENGINE_NAME_NOT_BOUND')
    expect(failureMessage(() => run('R', { R: OHM }))).toContain('@R')
    expect(failureCode(() => run('$sum_{k=1}^{N-1}(k)', { N: parseSetValue({ num: 3 }) }))).toBe('ENGINE_NAME_NOT_BOUND')
  })

  it('evaluates $sum, $prod and $seq over the inclusive bounds', () => {
    expect(number('$sum_{k=1}^{4}(k)')).toBe(10)
    expect(number('$prod_{k=1}^{4}(k)')).toBe(24)
    const sequence = run('$seq_{k=1}^{3}(k^2)')
    expect(sequence.kind).toBe('array')
    if (sequence.kind !== 'array') return
    expect(sequence.items.map((item) => (item.kind === 'number' ? item.num : NaN))).toEqual([1, 4, 9])
    expect(sequence.dim).toEqual([0, 0, 0, 0, 0, 0, 0])
  })

  it('takes a bound from a slot and from $len', () => {
    const array = parseSetValue({ array: [1, 2, 3] })
    expect(number('$sum_{k=0}^{@n-1}(k)', { n: parseSetValue({ num: 3 }) })).toBe(3)
    expect(number('$sum_{k=1}^{$len(@a)}(k)', { a: array })).toBe(6)
  })

  it('refuses a bound that is not an integer with the zero vector, or is inverted', () => {
    expect(failureCode(() => run('$sum_{k=3}^{1}(k)'))).toBe('ENGINE_INVALID_INDEX')
    expect(failureCode(() => run('$sum_{k=1}^{2.5}(k)'))).toBe('ENGINE_INVALID_INDEX')
    expect(failureCode(() => run('$sum_{k=1}^{@R}(k)', { R: OHM }))).toBe('ENGINE_INVALID_INDEX')
  })

  it('builds a row-major two-dimensional array from nested $seq', () => {
    const matrix = run('$seq_{i=1}^{2}($seq_{j=1}^{2}(i*j))')
    expect(matrix.kind).toBe('array')
    if (matrix.kind !== 'array') return
    const rows = matrix.items
    expect(rows.every((row) => row.kind === 'array')).toBe(true)
    expect(
      rows.map((row) => (row.kind === 'array' ? row.items.map((item) => (item.kind === 'number' ? item.num : NaN)) : [])),
    ).toEqual([
      [1, 2],
      [2, 4],
    ])
  })

  it('refuses a sequence whose elements do not share one SI vector', () => {
    expect(failureCode(() => run('$seq_{k=1}^{2}(@Z^k)', { Z: OHM }))).toBe('ENGINE_INCOMPATIBLE_DIMENSION')
  })
})

describe('the notation table', () => {
  it('refuses an unknown notation, a missing parenthesis and a position on a constant', () => {
    expect(failureCode(() => run('$nope(1)'))).toBe('ENGINE_INVALID_NOTATION')
    expect(failureMessage(() => run('$nope(1)'))).toContain('$sum')
    expect(failureCode(() => run('$abs'))).toBe('ENGINE_INVALID_NOTATION')
    expect(failureCode(() => run('$pi(2)'))).toBe('ENGINE_INVALID_NOTATION')
    expect(failureCode(() => run('$pi^{2}'))).toBe('ENGINE_INVALID_FORMULA')
  })

  it('takes a position directly after the name, so $e^(2) is a power', () => {
    expect(number('$e^(2)')).toBeCloseTo(Math.E ** 2, 12)
    expect(number('$pi^2')).toBeCloseTo(Math.PI ** 2, 12)
  })

  it('checks the arity of a function and the bounds of a binding symbol', () => {
    expect(failureCode(() => run('$min(1)'))).toBe('ENGINE_INVALID_ARITY')
    expect(failureCode(() => run('$abs(1,2)'))).toBe('ENGINE_INVALID_ARITY')
    expect(failureCode(() => run('$sum(@R)', { R: OHM }))).toBe('ENGINE_INVALID_ARITY')
    expect(failureCode(() => run('$limit(x)'))).toBe('ENGINE_INVALID_ARITY')
  })

  it('writes but does not evaluate $integral, $limit and $diff', () => {
    for (const formula of ['$integral_{0}^{1}(x*x, x)', '$integral(x*x, x)', '$limit_{x->0}(x)', '$diff(x*x, x)', '$diff(x*x, x, 2)']) {
      expect(failureCode(() => run(formula))).toBe('ENGINE_UNSUPPORTED_SYMBOL')
    }
  })

  it('computes the documented functions', () => {
    expect(number('$abs(-3)')).toBe(3)
    expect(number('$sqrt(9)')).toBe(3)
    expect(number('$floor(2.7)')).toBe(2)
    expect(number('$ceil(2.1)')).toBe(3)
    expect(number('$sign(-4)')).toBe(-1)
    expect(number('$mod(7,3)')).toBe(1)
    expect(number('$min(7,3)')).toBe(3)
    expect(number('$max(7,3)')).toBe(7)
    expect(number('$sin(0)')).toBe(0)
    expect(number('$ln($e)')).toBeCloseTo(1, 12)
    expect(number('$log(1000)')).toBeCloseTo(3, 12)
    expect(number('$atan2(0,0)')).toBe(0)
    expect(number('$arg(0)')).toBe(0)
    expect(number('$re(3+4j)')).toBe(3)
    expect(number('$im(3+4j)')).toBe(4)
    expect(number('$abs(3+4j)')).toBe(5)
  })

  it('refuses the documented domain violations', () => {
    expect(failureCode(() => run('$ln(-1)'))).toBe('ENGINE_UNDEFINED_RESULT')
    expect(failureCode(() => run('$asin(2)'))).toBe('ENGINE_UNDEFINED_RESULT')
    expect(failureCode(() => run('$mod(5,0)'))).toBe('ENGINE_UNDEFINED_RESULT')
    expect(failureCode(() => run('$sqrt(-1)'))).toBe('ENGINE_UNDEFINED_RESULT')
  })

  it('computes a complex exponent over a dimensionless base', () => {
    const rotation = run('2^(2j)')
    expect(rotation.kind).toBe('complex')
    const imaginary = run('$j^$j')
    expect(imaginary.kind).toBe('complex')
    if (imaginary.kind !== 'complex') return
    expect(imaginary.re).toBeCloseTo(Math.exp(-Math.PI / 2), 12)
    expect(number('$re($e^(-$j*$pi/6))')).toBeCloseTo(Math.cos(Math.PI / 6), 12)
  })
})

describe('data access', () => {
  const slots: Record<string, Value> = {
    a: parseSetValue({ array: [1, 2, 3] }),
    b: parseSetValue({ array: [10, 20, 30] }),
    v: parseSetValue({ array: [1, 2, 3], dim: 'volt' }),
    n: parseSetValue({ num: 5 }),
    o: parseSetValue({ object: { v: { num: 12, dim: 'volt' }, r: { num: 2, dim: 'ohm' } } }),
    M: parseSetValue({ array: [[1, 2], [3, 4]] }),
  }

  it('indexes an array with an integer expression', () => {
    expect(number('@a[1]', slots)).toBe(2)
    expect(number('@a[$len(@a)-1]', slots)).toBe(3)
    expect(number('@a[@n-4]', slots)).toBe(2)
  })

  it('refuses an out-of-range index, a fractional index and an index on a scalar', () => {
    expect(failureCode(() => run('@a[3]', slots))).toBe('ENGINE_INVALID_INDEX')
    expect(failureMessage(() => run('@a[3]', slots))).toContain('3 element')
    expect(failureCode(() => run('@a[1.5]', slots))).toBe('ENGINE_INVALID_INDEX')
    expect(failureCode(() => run('@n[0]', slots))).toBe('ENGINE_UNSUPPORTED_INDEX')
  })

  it('reads an object field and chains', () => {
    expect(number('@o.v', slots)).toBe(12)
    expect(failureCode(() => run('@o.missing', slots))).toBe('ENGINE_FIELD_NOT_FOUND')
    expect(failureMessage(() => run('@o.missing', slots))).toContain('v, r')
    expect(number('@M[1][0]', slots)).toBe(3)
    expect(number('$transpose(@M)[0][1]', slots)).toBe(3)
    expect(failureCode(() => run('$transpose(@a)', slots))).toBe('ENGINE_INVALID_ARGS')
    expect(failureCode(() => run('$len(@n)', slots))).toBe('ENGINE_INVALID_ARGS')
  })

  it('does arithmetic element by element and broadcasts a scalar', () => {
    const sum = run('@a+@b', slots)
    expect(sum.kind).toBe('array')
    if (sum.kind !== 'array') return
    expect(sum.items.map((item) => (item.kind === 'number' ? item.num : NaN))).toEqual([11, 22, 33])
    const scaled = run('2*@a', slots)
    if (scaled.kind !== 'array') throw new Error('expected an array')
    expect(scaled.items.map((item) => (item.kind === 'number' ? item.num : NaN))).toEqual([2, 4, 6])
    expect(failureCode(() => run('@a+@short', { ...slots, short: parseSetValue({ array: [1, 2] }) }))).toBe('ENGINE_INVALID_ARGS')
    expect(failureCode(() => run('@a+@v', slots))).toBe('ENGINE_INCOMPATIBLE_DIMENSION')
    expect(failureCode(() => run('@o+1', slots))).toBe('ENGINE_UNSUPPORTED_OPERATION')
  })
})

describe('dimension rules', () => {
  const slots: Record<string, Value> = {
    V: V_IN,
    R: OHM,
    R2,
    L: LENGTH,
    Z: parseSetValue({ re: 3, im: 4, dim: 'ohm' }),
    r: parseSetValue({ num: 2, dim: 'ohm' }),
    theta: parseSetValue({ num: 0.5 }),
    t: NET,
  }

  it('adds and subtracts only equal vectors', () => {
    expect(dim('@R+@R2', slots)).toEqual([2, 1, -3, -2, 0, 0, 0])
    expect(failureCode(() => run('@V+@R', slots))).toBe('ENGINE_INCOMPATIBLE_DIMENSION')
    expect(failureCode(() => run('5+@V', slots))).toBe('ENGINE_INCOMPATIBLE_DIMENSION')
    expect(dim('5+5')).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(number('5*@R', slots)).toBe(23500)
    expect(dim('5*@R', slots)).toEqual([2, 1, -3, -2, 0, 0, 0])
    expect(dim('@V/@R', slots)).toEqual([0, 0, 0, 1, 0, 0, 0])
    expect(dim('@R/@R2', slots)).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(dim('@theta*@r', slots)).toEqual([2, 1, -3, -2, 0, 0, 0])
    expect(dim('@t*@V', slots)).toEqual([2, 1, -2, -1, 0, 0, 0])
  })

  it('scales the vector with a real exponent and halves it with $sqrt', () => {
    expect(dim('@V^2', slots)).toEqual([4, 2, -6, -2, 0, 0, 0])
    expect(dim('$sqrt(@L)', slots)).toEqual([0.5, 0, 0, 0, 0, 0, 0])
    expect(dim('@L^(1/3)', slots)).toEqual([1 / 3, 0, 0, 0, 0, 0, 0])
  })

  it('refuses an exponent with a dimension and a complex exponent on a quantity', () => {
    expect(failureCode(() => run('2^@R', slots))).toBe('ENGINE_INCOMPATIBLE_DIMENSION')
    expect(failureCode(() => run('@R^$j', slots))).toBe('ENGINE_INCOMPATIBLE_DIMENSION')
    expect(dim('@r*$e^($j*@theta)', slots)).toEqual([2, 1, -3, -2, 0, 0, 0])
  })

  it('checks the argument vector of every function class', () => {
    expect(failureCode(() => run('$sin(@V)', slots))).toBe('ENGINE_INCOMPATIBLE_DIMENSION')
    expect(failureCode(() => run('$ln(@R)', slots))).toBe('ENGINE_INCOMPATIBLE_DIMENSION')
    expect(failureCode(() => run('$atan2(@V,@R)', slots))).toBe('ENGINE_INCOMPATIBLE_DIMENSION')
    expect(failureCode(() => run('$min(@V,@R)', slots))).toBe('ENGINE_INCOMPATIBLE_DIMENSION')
    expect(number('$arg(@Z)', slots)).toBeCloseTo(Math.atan2(4, 3), 12)
    expect(number('$arg(0)')).toBe(0)
    expect(number('$atan2(0,0)')).toBe(0)
    expect(dim('$abs(@Z)', slots)).toEqual([2, 1, -3, -2, 0, 0, 0])
    expect(number('$abs(@Z)', slots)).toBe(5)
    expect(dim('$re(@Z)', slots)).toEqual([2, 1, -3, -2, 0, 0, 0])
    expect(dim('$atan(@theta)', slots)).toEqual([0, 0, 0, 0, 0, 0, 0])
  })
})
