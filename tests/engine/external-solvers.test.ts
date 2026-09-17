import { describe, expect, it } from 'vitest'
import { compileExternalSolver } from '../../src/engine/external-solvers.ts'
import { QuantityKind } from '../../src/math/quantity-kind.ts'
import { DeclarationParamType, DeclarationTransport, type ToolDeclaration, type ToolReturns } from '../../src/tool.ts'

const BASE: ToolDeclaration = {
  name: 'sample_echo',
  description: 'sample',
  enabled: true,
  parameters: {
    message: { type: DeclarationParamType.String, required: true },
    count: { type: DeclarationParamType.Complex, kind: QuantityKind.None },
  },
  transport: DeclarationTransport.Http,
  transportOptions: { url: 'http://127.0.0.1:1/x' },
}

describe('compileExternalSolver', () => {
  it('maps a declaration with an object returns into an external SolverDef', () => {
    const solver = compileExternalSolver({
      ...BASE,
      returns: { type: 'object', fields: { message: { type: 'string' }, count: { type: 'number', kind: QuantityKind.None } } },
    })
    expect(solver).not.toBeNull()
    expect(solver!.id).toBe('sample_echo')
    expect(solver!.external).toMatchObject({ transport: 'http' })
    expect(solver!.returns).toEqual({
      type: 'object',
      fields: { message: { type: 'string' }, count: { type: 'number', kind: 'none' } },
    })
  })

  it('registers returns: null as a void solver (explicit)', () => {
    const solver = compileExternalSolver({ ...BASE, returns: null })
    expect(solver).not.toBeNull()
    expect(solver!.returns).toBeNull()
  })

  it('rejects a missing returns (a declaration without one never registers)', () => {
    expect(() => compileExternalSolver(BASE)).toThrow(/needs an explicit returns/)
  })

  it('rejects the unmappable any leaf', () => {
    expect(() => compileExternalSolver({ ...BASE, returns: { type: 'any' } })).toThrow(/cannot be mapped/)
  })

  it('maps a complex leaf with its kind', () => {
    const solver = compileExternalSolver({ ...BASE, returns: { type: 'complex', kind: QuantityKind.Voltage } })
    expect(solver!.returns).toEqual({ type: 'complex', kind: 'voltage' })
  })

  it('maps an array field with its items', () => {
    const solver = compileExternalSolver({
      ...BASE,
      returns: { type: 'object', fields: { values: { type: 'array', items: { type: 'number', kind: QuantityKind.None } } } },
    })
    expect(solver!.returns).toEqual({
      type: 'object',
      fields: { values: { type: 'array', items: { type: 'number', kind: 'none' } } },
    })
  })

  it('rejects an unmappable returns leaf instead of dropping the spec', () => {
    // An unknown leaf must fail here: dropping it silently would leave an array without items
    // and only break the spec later, on the first call.
    const unmappable = { type: 'integer', kind: QuantityKind.None } as unknown as ToolReturns
    expect(() => compileExternalSolver({ ...BASE, returns: { type: 'object', fields: { values: unmappable } } }))
      .toThrow(/unknown returns type "integer"/)
  })
})
