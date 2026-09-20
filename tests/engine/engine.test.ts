import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QuantityKind } from '../../src/math/quantity-kind.ts'
import { Engine } from '../../src/engine/engine.ts'
import { VariableTable } from '../../src/engine/table.ts'
import { toCanonical, validateValue } from '../../src/engine/values.ts'

let home = ''

function makeEngine(): Engine {
  home = mkdtempSync(join(tmpdir(), 'reckoner-engine-'))
  const engine = new Engine(home)
  engine.start()
  return engine
}

/** Put a value in a slot without going through the (not yet written) value parser. */
function seedTable(engine: Engine, name: string, value: Parameters<VariableTable['set']>[1]): void {
  engine.table.set(name, value)
}

afterEach(() => {
  if (home.length > 0) rmSync(home, { recursive: true, force: true })
})

describe('value universe validateValue', () => {
  it('accepts canonical typed values and rejects malformed shapes', () => {
    expect(validateValue({ type: 'number', value: 100, kind: 'resistance' })).toBeUndefined()
    expect(validateValue({ type: 'number', value: 25, kind: 'temperature' })).toBeUndefined()
    expect(validateValue({ type: 'complex', value: { re: 1, im: 2 }, kind: 'voltage' })).toBeUndefined()
    expect(validateValue({ type: 'string', value: 'x' })).toBeUndefined()
    expect(validateValue({ type: 'boolean', value: true })).toMatch(/unknown type "boolean"/)
    expect(validateValue(5)).toMatch(/typed-value/)
    expect(validateValue({ type: 'number', value: 1, kind: 'bogus' })).toMatch(/unknown kind/)
    expect(validateValue({ type: 'number', value: 1 })).toMatch(/requires a kind/)
  })
})

describe('toCanonical', () => {
  it('normalises a polar complex to rectangular, recursing into arrays and objects', () => {
    expect(toCanonical({
      type: 'complex', value: { mag: 2, ang: Math.PI / 2 }, kind: QuantityKind.Voltage,
    } as never)).toEqual({
      type: 'complex', value: { re: Math.cos(Math.PI / 2) * 2, im: Math.sin(Math.PI / 2) * 2 }, kind: QuantityKind.Voltage,
    })
    expect(toCanonical({
      type: 'object',
      value: {
        note: { type: 'string', value: 'kept' },
        z: { type: 'complex', value: { mag: 1, ang: 0 }, kind: QuantityKind.Resistance },
      },
    } as never)).toEqual({
      type: 'object',
      value: {
        note: { type: 'string', value: 'kept' },
        z: { type: 'complex', value: { re: 1, im: 0 }, kind: QuantityKind.Resistance },
      },
    })
  })
})

describe('variable table', () => {
  it('pins kind, bumps rev on overwrite, rejects different kinds, restarts rev at 1 after delete', () => {
    const table = new VariableTable()
    const r = table.set('R', { type: 'number', value: 100, kind: QuantityKind.Resistance })
    expect(r.rev).toBe(1)
    expect(table.set('R', { type: 'number', value: 220, kind: QuantityKind.Resistance }).rev).toBe(2)
    expect(() => table.set('R', { type: 'number', value: 5, kind: QuantityKind.Time })).toThrow(/pinned/)
    expect(table.delete('R')).toBe(true)
    expect(table.delete('R')).toBe(false)
    expect(table.set('R', { type: 'number', value: 7, kind: QuantityKind.Resistance }).rev).toBe(1)
  })
})

describe('engine (markers + trace + lifecycle)', () => {
  it('lifecycle: question opens, answer settles; reopening seals the old record as duplicate-start', () => {
    const engine = makeEngine()
    expect(engine.markerQuestion('q1').ok).toBe(true)
    engine.markerAnswer('answer one')
    expect(engine.isOpen()).toBe(false)
    const reopened = engine.markerQuestion('q2')
    const oldId = String((reopened as unknown as { record: string }).record)
    engine.markerQuestion('q3') // reopening → q2 is sealed as duplicate-start
    expect(engine.isOpen()).toBe(true)
    expect(engine.store.readRows(oldId).some((row) => row.tool === 'seal' && row.kind === 'duplicate-start')).toBe(true)
    expect(engine.indexRows().find((row) => row.id === oldId)?.sealedAt).not.toBeNull()
    engine.markerAnswer('final')
  })

  it('answer with no open record keeps a duplicate-end error record', () => {
    const engine = makeEngine()
    expect(engine.markerAnswer('stray')).toMatchObject({ ok: true, error: 'duplicate-end' })
    expect(engine.isOpen()).toBe(false)
    const index = engine.indexRows()
    expect(index).toHaveLength(1)
    expect(index[0]!.sealedAt).not.toBeNull()
  })

  it('a new question clears the table and resets slot revisions', () => {
    const engine = makeEngine()
    engine.markerQuestion('q1')
    seedTable(engine, 'test', { type: 'string', value: 'old' })
    seedTable(engine, 'R', { type: 'number', value: 100, kind: QuantityKind.Resistance })
    expect(engine.table.set('R', { type: 'number', value: 220, kind: QuantityKind.Resistance }).rev).toBe(2)
    engine.markerAnswer('done')
    // The next question starts from an empty table: old slots are gone, rev restarts at 1.
    engine.markerQuestion('q2')
    expect(engine.table.get('test')).toBeUndefined()
    expect(engine.table.get('R')).toBeUndefined()
    expect(engine.table.set('R', { type: 'number', value: 5, kind: QuantityKind.Resistance }).rev).toBe(1)
    engine.markerAnswer('done again')
  })

  it('refuses a slot name that is not an identifier, with no side effects', () => {
    const engine = makeEngine()
    engine.markerQuestion('q')
    expect(engine.opGet('1R')).toMatchObject({ ok: false, code: 'ENGINE_ARGS_INVALID' })
    expect(engine.opGet('R')).toMatchObject({ ok: false, code: 'ENGINE_SLOT_UNDECLARED' })
    // The failure is recorded, and nothing was created.
    const rows = engine.store.readRows(String(engine.openId()))
    expect(rows.filter((row) => row.ok === false)).toHaveLength(2)
    expect(engine.table.get('R')).toBeUndefined()
    engine.markerAnswer('done')
  })

  it('set with null deletes a slot and records the deletion', () => {
    const engine = makeEngine()
    engine.markerQuestion('q')
    // Seed through the table, then delete through the engine op (null is a real input).
    seedTable(engine, 'R', { type: 'number', value: 100, kind: QuantityKind.Resistance })
    expect(engine.opSet('R', null)).toMatchObject({ ok: true, deleted: true })
    expect(engine.table.get('R')).toBeUndefined()
    expect(engine.opSet('R', null)).toMatchObject({ ok: true, deleted: false })
    const rows = engine.store.readRows(String(engine.openId()))
    expect(rows.filter((row) => row.tool === 'set' && row.deleted === true)).toHaveLength(1)
    engine.markerAnswer('done')
  })

  it('interruption recovery: a restart replays the trace and continues the same file', () => {
    const engine = makeEngine()
    engine.markerQuestion('q')
    // A row written the way opSet writes it; the value parser lands in the next phase.
    engine.store.appendRow(String(engine.openId()), {
      seq: 2, at: Date.now(), tool: 'set', ok: true, name: 'R', rev: 1,
      value: { type: 'number', value: 100, kind: QuantityKind.Resistance },
    } as never)
    engine.table.set('R', { type: 'number', value: 100, kind: QuantityKind.Resistance })
    const id = String(engine.openId())
    // Simulate a restart: a new engine on the same home.
    const revived = new Engine(home)
    revived.start()
    expect(revived.openId()).toBe(id)
    // The table comes back from the stored trace — not from recomputation.
    expect(revived.table.get('R')?.value).toMatchObject({ type: 'number', value: 100, kind: 'resistance' })
    revived.markerAnswer('done')
    expect(revived.isOpen()).toBe(false)
  })
})

describe('eval: writes the target and traces the step', () => {
  it('evaluates a formula, writes the target, and records formula/vars/result', () => {
    const engine = makeEngine()
    engine.markerQuestion('divider')
    expect(engine.opSet('V_in', '12volt')).toMatchObject({ ok: true, rev: 1 })
    expect(engine.opSet('R1', '4.7kohm')).toMatchObject({ ok: true, rev: 1 })
    expect(engine.opSet('R2', '220ohm')).toMatchObject({ ok: true, rev: 1 })

    expect(engine.opEval('@V_in*@R2/(@R1+@R2)', 'V_out')).toMatchObject({ ok: true, target: 'V_out', rev: 1 })
    // eval does not return the value: the model reads it with get.
    expect(engine.opGet('V_out')).toMatchObject({ ok: true, value: '0.536585365854volt' })

    const row = engine.store.readRows(String(engine.openId())).find((item) => item.tool === 'eval')
    expect(row).toMatchObject({
      tool: 'eval', ok: true, formula: '@V_in*@R2/(@R1+@R2)', target: 'V_out', rev: 1,
      vars: {
        V_in: { type: 'number', value: 12, kind: 'voltage' },
        R1: { type: 'number', value: 4700, kind: 'resistance' },
        R2: { type: 'number', value: 220, kind: 'resistance' },
      },
      result: { type: 'number', value: 12 * (220 / 4920), kind: 'voltage' },
    })
    engine.markerAnswer('done')
  })

  it('overwrites the same slot with the same kind and bumps rev', () => {
    const engine = makeEngine()
    engine.markerQuestion('q')
    engine.opSet('R', '100ohm')
    expect(engine.opEval('2*@R', 'R2')).toMatchObject({ ok: true, rev: 1 })
    expect(engine.opEval('3*@R', 'R2')).toMatchObject({ ok: true, rev: 2 })
    engine.markerAnswer('done')
  })

  it('refuses a result whose kind differs from the slot it would write, with no side effect', () => {
    const engine = makeEngine()
    engine.markerQuestion('q')
    engine.opSet('R', '100ohm')
    // 100 * R is an unnamed dimension (ohm^2), and R2 is pinned to resistance.
    const refused = engine.opEval('@R*@R', 'R2')
    expect(refused).toMatchObject({ ok: false, code: 'ENGINE_DIM_MISMATCH' })
    expect(engine.table.get('R2')).toBeUndefined()
    // R2 pinned to resistance, then a current written there is refused.
    engine.opEval('1*@R', 'R2')
    expect(engine.opEval('@R/@R', 'R2')).toMatchObject({ ok: false, code: 'ENGINE_DIM_MISMATCH' })
    expect(engine.table.get('R2')?.rev).toBe(1)
    engine.markerAnswer('done')
  })

  it('with target null evaluates without writing a slot', () => {
    const engine = makeEngine()
    engine.markerQuestion('q')
    engine.opSet('R', '100ohm')
    expect(engine.opEval('@R/@R', null)).toMatchObject({ ok: true, target: null, rev: null })
    expect(engine.table.has('P')).toBe(false)
    const row = engine.store.readRows(String(engine.openId())).find((item) => item.tool === 'eval')
    expect(row).toMatchObject({ target: null, result: { type: 'number', value: 1, kind: 'none' } })
    engine.markerAnswer('done')
  })

  it('refuses an undeclared slot and a bad target name, recording the failure and nothing else', () => {
    const engine = makeEngine()
    engine.markerQuestion('q')
    expect(engine.opEval('@nope*2', 'X')).toMatchObject({ ok: false, code: 'ENGINE_SLOT_UNDECLARED' })
    expect(engine.opEval('1+1', 'not a name')).toMatchObject({ ok: false, code: 'ENGINE_ARGS_INVALID' })
    expect(engine.table.entries()).toHaveLength(0)
    const rows = engine.store.readRows(String(engine.openId())).filter((row) => row.ok === false)
    expect(rows).toHaveLength(2)
    engine.markerAnswer('done')
  })

  it('recovering a record replays eval results from their stored values', () => {
    const engine = makeEngine()
    engine.markerQuestion('q')
    engine.opSet('V', '12volt')
    engine.opSet('R', '4ohm')
    engine.opEval('@V/@R', 'I')
    const revived = new Engine(home)
    revived.start()
    expect(revived.table.get('I')?.value).toMatchObject({ type: 'number', value: 3, kind: 'current' })
    revived.markerAnswer('done')
  })
})

describe('receipts are serializable (tool boundary)', () => {
  it('a receipt is a JSON-serializable object', () => {
    const engine = makeEngine()
    engine.markerQuestion('q')
    const receipt = engine.markerAnalyse('approach')
    expect(() => JSON.stringify(receipt)).not.toThrow()
    expect(JSON.parse(JSON.stringify(receipt))).toMatchObject({ ok: true })
  })
})
