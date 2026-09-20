import { describe, expect, it } from 'vitest'
import { ToolError } from '../../src/errors.ts'
import { QuantityKind } from '../../src/math/quantity-kind.ts'
import { evaluateFormula, type EvalContext } from '../../src/engine/formula.ts'
import type { TypedValue } from '../../src/engine/values.ts'

/** A slot table for a formula: name → stored value. */
function slots(values: Record<string, TypedValue>): { context: EvalContext; used: Map<string, TypedValue> } {
  const used = new Map<string, TypedValue>()
  return {
    used,
    context: {
      readSlot: (name) => values[name],
      used,
    },
  }
}

const VOLT = (value: number): TypedValue => ({ type: 'number', value, kind: QuantityKind.Voltage })
const OHM = (value: number): TypedValue => ({ type: 'number', value, kind: QuantityKind.Resistance })

/** Evaluate and return the value. */
function run(source: string, values: Record<string, TypedValue> = {}): TypedValue {
  return evaluateFormula(source, slots(values).context)
}

/** Evaluate, expecting a refusal, and return the ToolError. */
function refusal(source: string, values: Record<string, TypedValue> = {}): ToolError {
  try {
    run(source, values)
  } catch (error) {
    if (error instanceof ToolError) return error
    throw error
  }
  throw new Error(`"${source}" was accepted but should have been refused`)
}

const VIN = { V_in: VOLT(12), R1: OHM(4700), R2: OHM(220) }

describe('formula: numbers, units and precedence', () => {
  it('reads a quantity with its kind', () => {
    expect(run('4.7kohm')).toEqual({ type: 'number', value: 4700, kind: 'resistance' })
    expect(run('1e5')).toEqual({ type: 'number', value: 100000, kind: 'none' })
    expect(run('25degC')).toEqual({ type: 'number', value: 298.15, kind: 'temperature' })
  })

  it('reads a complex literal', () => {
    expect(run('2j')).toEqual({ type: 'complex', value: { re: 0, im: 2 }, kind: 'none' })
    expect(run('3+4i')).toEqual({ type: 'complex', value: { re: 3, im: 4 }, kind: 'none' })
  })

  it('applies the usual precedence, with ^ right-associative and unary minus looser than ^', () => {
    expect(run('2+3*4')).toEqual({ type: 'number', value: 14, kind: 'none' })
    expect(run('(2+3)*4')).toEqual({ type: 'number', value: 20, kind: 'none' })
    expect(run('2^3^2')).toEqual({ type: 'number', value: 512, kind: 'none' })
    expect(run('-2^2')).toEqual({ type: 'number', value: -4, kind: 'none' })
    expect(run('2^-2')).toEqual({ type: 'number', value: 0.25, kind: 'none' })
    expect(run('10-2-3')).toEqual({ type: 'number', value: 5, kind: 'none' })
    expect(run('100/5/2')).toEqual({ type: 'number', value: 10, kind: 'none' })
  })

  it('keeps the kind through a plain-count multiplier', () => {
    expect(run('2*4.7kohm')).toEqual({ type: 'number', value: 9400, kind: 'resistance' })
    expect(run('4.7kohm*2')).toEqual({ type: 'number', value: 9400, kind: 'resistance' })
    expect(run('-4.7kohm')).toEqual({ type: 'number', value: -4700, kind: 'resistance' })
  })
})

describe('formula: slots and dimensions', () => {
  it('derives the kind of a quotient: @V/@R is a current', () => {
    expect(run('@V_in/@R1', VIN)).toEqual({ type: 'number', value: 12 / 4700, kind: 'current' })
  })

  it('reads slots and reports which ones it read, in order', () => {
    const { context, used } = slots(VIN)
    evaluateFormula('@R1+@R2', context)
    expect([...used.keys()]).toEqual(['R1', 'R2'])
  })

  it('refuses an undeclared slot without reading anything', () => {
    const { context, used } = slots(VIN)
    const error = (() => {
      try {
        evaluateFormula('@R3*2', context)
      } catch (caught) {
        return caught as ToolError
      }
      throw new Error('accepted')
    })()
    expect(error.code).toBe('ENGINE_SLOT_UNDECLARED')
    expect(error.message).toMatch(/slot "R3" is not declared/)
    expect(used.size).toBe(0)
  })

  it('allows an unnamed dimension mid-formula and names the result', () => {
    // The voltage divider: Vth^2/(4*Rth) is a power, although Vth^2 has no kind.
    const formula = '(@V_in*@R2/(@R1+@R2))^2/(4*(@R1*@R2/(@R1+@R2)))'
    const result = run(formula, VIN) as { type: string; kind: string; value: number }
    expect(result.kind).toBe('power')
    const expected = ((12 * 220) / (4700 + 220)) ** 2 / (4 * ((4700 * 220) / (4700 + 220)))
    expect(result.type).toBe('number')
    expect(result.value).toBeCloseTo(expected, 12)
  })

  it('refuses a bare count added to a quantity — 5 + @V_in is ambiguous', () => {
    const error = refusal('5+@V_in', VIN)
    expect(error.code).toBe('ENGINE_DIM_MISMATCH')
    expect(error.message).toMatch(/plain count/)
  })

  it('refuses adding two different quantities', () => {
    expect(refusal('@V_in+@R1', VIN).message).toMatch(/their dimensions differ/)
  })

  it('refuses a result whose dimension no kind names — (4ohm)^2 lands nowhere', () => {
    const error = refusal('(4ohm)^2')
    expect(error.code).toBe('ENGINE_DIM_MISMATCH')
    expect(error.message).toMatch(/no kind names/)
    expect(error.message).toMatch(/split the formula/)
  })

  it('refuses an exponent that carries a unit', () => {
    expect(refusal('2^3volt').message).toMatch(/exponent must be a plain count/)
  })

  it('refuses a dimensionless quotient of two counts as a plain count, not a kind', () => {
    expect(run('@V_in/@R1*@R1', VIN)).toMatchObject({ kind: 'voltage' })
  })
})

describe('formula: notations', () => {
  it('reads the constants', () => {
    expect(run('$pi')).toEqual({ type: 'number', value: Math.PI, kind: 'none' })
    expect(run('2*$pi')).toEqual({ type: 'number', value: 2 * Math.PI, kind: 'none' })
    expect(run('$inf')).toEqual({ type: 'number', value: Number.POSITIVE_INFINITY, kind: 'none' })
    expect(run('$j')).toEqual({ type: 'complex', value: { re: 0, im: 1 }, kind: 'none' })
  })

  it('reads a constant with no subscript, and refuses one with a position', () => {
    expect(refusal('$pi_{k=1}').message).toMatch(/constant and takes no subscript/)
  })

  it('applies functions, keeping the kind through $abs', () => {
    expect(run('$abs(-4.7kohm)')).toEqual({ type: 'number', value: 4700, kind: 'resistance' })
    expect(run('$sqrt(16)')).toEqual({ type: 'number', value: 4, kind: 'none' })
    expect(run('$re(3+4j)')).toEqual({ type: 'number', value: 3, kind: 'none' })
    expect(run('$im(3+4j)')).toEqual({ type: 'number', value: 4, kind: 'none' })
    expect(run('$conj(3+4j)')).toEqual({ type: 'complex', value: { re: 3, im: -4 }, kind: 'none' })
    expect(run('$min(3,5)')).toEqual({ type: 'number', value: 3, kind: 'none' })
    expect(run('$max(3,5)')).toEqual({ type: 'number', value: 5, kind: 'none' })
    expect(run('$mod(7,3)')).toEqual({ type: 'number', value: 1, kind: 'none' })
    expect(run('$atan2(1,1)')).toMatchObject({ kind: 'angle' })
  })

  it('takes an angle in radians and returns a plain count', () => {
    expect((run('$sin($pi/6)') as { value: number }).value).toBeCloseTo(0.5, 12)
    expect((run('$sin(30deg)') as { value: number }).value).toBeCloseTo(0.5, 12)
    expect(run('$tan(45deg)')).toMatchObject({ kind: 'none' })
    expect(run('$sin(0.5235987755982988)')).toMatchObject({ kind: 'none' })
    expect(run('$asin(0.5)')).toMatchObject({ kind: 'angle' })
  })

  it('refuses a transcendental function of a quantity', () => {
    expect(refusal('$sin(@V_in)', VIN).message).toMatch(/takes an angle or a plain count, got voltage/)
    expect(refusal('$ln(@V_in)', VIN).message).toMatch(/takes a plain count, got voltage/)
  })

  it('refuses a min of two different quantities', () => {
    expect(refusal('$min(@V_in,@R1)', VIN).message).toMatch(/cannot compare/)
  })

  it('sums and multiplies over a range', () => {
    expect(run('$sum_{k=1}^{4}(k)')).toEqual({ type: 'number', value: 10, kind: 'none' })
    expect(run('$prod_{k=1}^{4}(k)')).toEqual({ type: 'number', value: 24, kind: 'none' })
    expect(run('$sum_{k=1}^{3}(k*1volt)')).toEqual({ type: 'number', value: 6, kind: 'voltage' })
  })

  it('builds an array with $seq and walks it with [ ]', () => {
    expect(run('$seq_{k=0}^{4}(k)')).toEqual({
      type: 'array',
      value: [0, 1, 2, 3, 4].map((value) => ({ type: 'number', value, kind: 'none' })),
    })
    expect(run('$seq_{k=0}^{2}(2*k)[2]')).toEqual({ type: 'number', value: 4, kind: 'none' })
    expect(run('$sum_{k=0}^{2}($seq_{j=0}^{1}(k+j)[1])')).toEqual({ type: 'number', value: 6, kind: 'none' })
  })

  it('takes the upper bound from an expression and a slot', () => {
    expect(run('$sum_{k=1}^{2+2}(k)')).toEqual({ type: 'number', value: 10, kind: 'none' })
    expect(run('$sum_{k=1}^{@R2}(1)', { R2: { type: 'number', value: 3, kind: QuantityKind.None } }))
      .toEqual({ type: 'number', value: 3, kind: 'none' })
  })

  it('refuses a range that runs downwards, and a step that is not a whole count', () => {
    expect(refusal('$sum_{k=3}^{1}(k)').message).toMatch(/below the lower bound/)
    expect(refusal('$sum_{k=1}^{2.5}(k)').message).toMatch(/upper bound must be a whole number/)
  })

  it('parses an integral, a derivative and a limit but cannot evaluate them', () => {
    for (const source of ['$integral_{0}^{1}(x^2, x)', '$diff(@R1, x)', '$limit_{x->0}(1/x)']) {
      expect(refusal(source, VIN).code).toBe('ENGINE_SYMBOL_NOT_EVALUABLE')
    }
    expect(refusal('$integral_{0}^{1}(x^2, x)').message).toMatch(/closed form/)
  })

  it('lists the vocabulary when a $ name is unknown', () => {
    const error = refusal('$foo(1)')
    expect(error.code).toBe('ENGINE_PARSE_SYMBOL')
    expect(error.message).toMatch(/is not a notation/)
    expect(error.message).toMatch(/\$abs/)
    expect(error.message).toMatch(/\$sum_\{k=a\}\^\{b\}\(body\)/)
  })

  it('refuses a function without its arguments, and a wrong argument count', () => {
    expect(refusal('$abs').code).toBe('ENGINE_PARSE_SYMBOL')
    expect(refusal('$abs()').message).toMatch(/takes 1 argument\(s\), got 0/)
    expect(refusal('$min(1)').message).toMatch(/takes 2 argument\(s\), got 1/)
    expect(refusal('$abs(1,2)').message).toMatch(/takes 1 argument\(s\), got 2/)
  })
})

describe('formula: arrays and data access', () => {
  it('combines arrays element by element and broadcasts a scalar', () => {
    expect(run('[1,2,3]*2')).toEqual({
      type: 'array',
      value: [2, 4, 6].map((value) => ({ type: 'number', value, kind: 'none' })),
    })
    expect(run('[1,2]+[3,4]')).toEqual({
      type: 'array',
      value: [4, 6].map((value) => ({ type: 'number', value, kind: 'none' })),
    })
  })

  it('refuses arrays of different lengths, and elements of different kinds', () => {
    expect(refusal('[1,2]+[3]').message).toMatch(/arrays must have the same length/)
    expect(refusal('[1volt,2ohm]').code).toBe('ENGINE_TYPE_MIXED_KIND')
    expect(refusal('[1,2volt]').code).toBe('ENGINE_TYPE_MIXED_KIND')
  })

  it('reads an element, a field, and refuses the rest', () => {
    expect(run('@h[1]', { h: { type: 'array', value: [OHM(1), OHM(2)] } })).toEqual({ type: 'number', value: 2, kind: 'resistance' })
    expect(run('@th.field', { th: { type: 'object', value: { field: VOLT(3) } } })).toEqual(VOLT(3))
    expect(refusal('@h[9]', { h: { type: 'array', value: [OHM(1)] } }).code).toBe('ENGINE_RANGE_INDEX')
    expect(refusal('@h[1.5]', { h: { type: 'array', value: [OHM(1), OHM(2)] } }).message).toMatch(/whole number/)
    expect(refusal('@V_in[0]', VIN).message).toMatch(/cannot be indexed/)
    expect(refusal('@V_in.field', VIN).message).toMatch(/has no fields/)
    expect(refusal('@th.missing', { th: { type: 'object', value: { other: VOLT(1) } } }).message).toMatch(/no field "missing"/)
  })

  it('transposes a matrix given as arrays of arrays', () => {
    expect(run('$transpose([[1,2],[3,4]])')).toEqual({
      type: 'array',
      value: [
        { type: 'array', value: [{ type: 'number', value: 1, kind: 'none' }, { type: 'number', value: 3, kind: 'none' }] },
        { type: 'array', value: [{ type: 'number', value: 2, kind: 'none' }, { type: 'number', value: 4, kind: 'none' }] },
      ],
    })
  })
})

describe('formula: refusals carry a fix', () => {
  const cases: Array<[string, RegExp]> = [
    ['', /the formula is empty/],
    ['1+', /ends where a value was expected/],
    ['@', /expected a slot name after "@"/],
    ['x', /is not bound/],
    ['1 2', /unexpected "2" after the expression/],
    ['(1', /expected the closing parenthesis/],
    ['1E5', /lowercase 'e'/],
    ['2e', /must be followed by digits/],
    ['4.7kiloohm', /is not a unit word/],
    ['$1', /expected a notation name/],
    ['1Ω', /is not allowed/],
    ['2*@V_in', /slot "V_in" is not declared/],
  ]
  for (const [source, pattern] of cases) {
    it(`refuses ${JSON.stringify(source)} with a fix`, () => {
      expect(refusal(source).message).toMatch(pattern)
    })
  }

  it('tells an unbound name how to read a slot', () => {
    expect(refusal('x+1').message).toMatch(/to read a slot write "@x"/)
  })

  it('never returns a partial value on failure', () => {
    const { context } = slots(VIN)
    expect(() => evaluateFormula('@V_in+@R1', context)).toThrow(ToolError)
  })
})
