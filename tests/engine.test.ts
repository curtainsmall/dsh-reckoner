import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Engine } from '../src/engine/engine.ts'
import type { TraceRow } from '../src/engine/record.ts'

let home: string
let engine: Engine
let clock: number

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'reckoner-'))
  clock = 1_700_000_000_000
  engine = new Engine(home, { now: () => (clock += 1) })
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

/** A record open and holding the three conditions of a simple divider. */
function openRecordWithConditions(): string {
  engine.markerQuestion('What is the current through R2?')
  engine.opSet('V_in', { num: 12, dim: 'volt' })
  engine.opSet('R2', { num: 220, dim: 'ohm' })
  const id = engine.openRecordId()
  if (id === null) throw new Error('the record did not open')
  return id
}

describe('the record gate', () => {
  it('refuses set, get and eval while no record is open', () => {
    expect(engine.opSet('R1', { num: 1, dim: 'ohm' })).toMatchObject({ ok: false, code: 'ENGINE_NO_RECORD' })
    expect(engine.opGet('R1')).toMatchObject({ ok: false, code: 'ENGINE_NO_RECORD' })
    expect(engine.opEval('1+1', 'x')).toMatchObject({ ok: false, code: 'ENGINE_NO_RECORD' })
    expect(existsSync(join(home, 'record-index.jsonl'))).toBe(false)
    expect(existsSync(join(home, 'records'))).toBe(false)
  })

  it('fails a marker with self-sufficient text', () => {
    const receipt = engine.opSet('R1', { num: 1 })
    expect(typeof receipt['error']).toBe('string')
    expect(String(receipt['error'])).toContain('record_question')
  })
})

describe('the record markers', () => {
  it('opens a record, indexes it and answers with {ok}', () => {
    expect(engine.markerQuestion('q')).toEqual({ ok: true })
    const rows = engine.indexRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.question).toBe('q')
    expect(rows[0]?.answeredAt).toBeNull()
    expect(typeof rows[0]?.openedAt).toBe('number')
    expect(engine.openRecordId()).toBe(rows[0]?.id)
    expect(engine.markerAnalyse('a')).toEqual({ ok: true })
    expect(engine.markerAnswer('the answer')).toEqual({ ok: true })
    expect(engine.openRecordId()).toBeNull()
    expect(engine.indexRows()[0]?.answeredAt).not.toBeNull()
  })

  it('clears the slot table when a record opens', () => {
    engine.markerQuestion('first')
    engine.opSet('R1', { num: 1, dim: 'ohm' })
    engine.markerAnswer('done')
    engine.markerQuestion('second')
    expect(engine.opGet('R1')).toMatchObject({ ok: false, code: 'ENGINE_SLOT_UNDECLARED' })
  })

  it('refuses a second question while a record is open, and records the failure in it', () => {
    const id = openRecordWithConditions()
    const receipt = engine.markerQuestion('another')
    expect(receipt).toMatchObject({ ok: false, code: 'ENGINE_RECORD_DUPLICATE' })
    expect(engine.indexRows()).toHaveLength(1)
    const rows = engine.readRows(id)
    const last = rows[rows.length - 1]
    expect(last?.tool).toBe('record_question')
    expect(last?.ok).toBe(false)
    expect(Object.keys(last?.content ?? {}).sort()).toEqual(['code', 'error'])
  })

  it('refuses an answer with no record open and writes nothing', () => {
    expect(engine.markerAnswer('nothing')).toMatchObject({ ok: false, code: 'ENGINE_RECORD_DUPLICATE' })
    expect(engine.indexRows()).toEqual([])
    expect(existsSync(join(home, 'records'))).toBe(false)
  })
})

describe('set', () => {
  beforeEach(() => {
    engine.markerQuestion('q')
  })

  it('echoes the stored fact with the dim as 7 integers', () => {
    expect(engine.opSet('R1', { num: 4.7e3, dim: 'ohm' })).toEqual({
      ok: true,
      name: 'R1',
      rev: 1,
      value: { num: 4700, dim: [2, 1, -3, -2, 0, 0, 0] },
    })
  })

  it('stores a polar complex rectangular', () => {
    const receipt = engine.opSet('Z', { mag: 5, ang: Math.atan2(4, 3), dim: 'ohm' })
    const value = receipt['value'] as { re: number; im: number; dim: unknown }
    expect(receipt['ok']).toBe(true)
    expect(value.re).toBeCloseTo(3, 10)
    expect(value.im).toBeCloseTo(4, 10)
    expect(value.dim).toEqual([2, 1, -3, -2, 0, 0, 0])
  })

  it('counts the revisions and deletes idempotently', () => {
    engine.opSet('R1', { num: 1, dim: 'ohm' })
    expect(engine.opSet('R1', { num: 2, dim: 'ohm' })['rev']).toBe(2)
    expect(engine.opSet('R1', null)).toEqual({ ok: true, name: 'R1', rev: null, value: null })
    expect(engine.opSet('R1', null)).toEqual({ ok: true, name: 'R1', rev: null, value: null })
    expect(engine.opSet('R1', { num: 3, dim: 'ohm' })['rev']).toBe(1)
  })

  it('refuses a name that is not an identifier and a value outside the tagged shape', () => {
    expect(engine.opSet('1x', { num: 1 })).toMatchObject({ ok: false, code: 'ENGINE_PARSE_IDENT' })
    expect(engine.opSet('R1', { num: 1, dim: 'bogus' })).toMatchObject({ ok: false, code: 'ENGINE_PARSE_UNIT' })
    expect(engine.opSet('R1', { num: 1, array: [1] })).toMatchObject({ ok: false, code: 'ENGINE_ARGS_INVALID' })
    expect(engine.opGet('R1')).toMatchObject({ ok: false, code: 'ENGINE_SLOT_UNDECLARED' })
  })
})

describe('get', () => {
  beforeEach(() => {
    engine.markerQuestion('q')
    engine.opSet('R1', { num: 4700, dim: 'ohm' })
    engine.opSet('T1', { num: 298.15, dim: 'kelvin' })
    engine.opSet('n', { num: 3 })
  })

  it('mentions the vector by its first name when no dim is asked for', () => {
    expect(engine.opGet('n')).toEqual({ ok: true, name: 'n', value: { num: 3, dim: 'dim-less' } })
    expect(engine.opGet('R1')).toEqual({ ok: true, name: 'R1', value: { num: 4700, dim: 'ohm' } })
  })

  it('converts through the requested name and echoes that spelling', () => {
    const receipt = engine.opGet('T1', { dim: 'degC' })
    expect(receipt['ok']).toBe(true)
    expect(receipt['name']).toBe('T1')
    const value = receipt['value'] as { num: number; dim: string }
    expect(value.num).toBeCloseTo(25, 10)
    expect(value.dim).toBe('degC')
  })

  it('checks a 7-integer dim without converting', () => {
    expect(engine.opGet('T1', { dim: [0, 0, 0, 0, 1, 0, 0] })).toEqual({
      ok: true,
      name: 'T1',
      value: { num: 298.15, dim: [0, 0, 0, 0, 1, 0, 0] },
    })
  })

  it('refuses a dim the slot does not hold', () => {
    expect(engine.opGet('R1', { dim: 'volt' })).toMatchObject({ ok: false, code: 'ENGINE_DIM_MISMATCH' })
  })

  it('applies digits and form to the leaves', () => {
    expect(engine.opGet('R1', { digits: 4, dim: 'ohm' })).toEqual({
      ok: true,
      name: 'R1',
      value: { num: 4700, dim: 'ohm' },
    })
    expect(engine.opGet('R1', { form: 'rect' })).toEqual({
      ok: true,
      name: 'R1',
      value: { re: 4700, im: 0, dim: 'ohm' },
    })
    expect(engine.opGet('R1', { form: 'polar' })).toEqual({
      ok: true,
      name: 'R1',
      value: { mag: 4700, ang: 0, dim: 'ohm' },
    })
    expect(engine.opGet('n', { form: 'polar' })).toEqual({
      ok: true,
      name: 'n',
      value: { mag: 3, ang: 0, dim: 'dim-less' },
    })
  })

  it('refuses an unknown slot and a malformed request', () => {
    expect(engine.opGet('missing')).toMatchObject({ ok: false, code: 'ENGINE_SLOT_UNDECLARED' })
    expect(engine.opGet('R1', { form: 'json' })).toMatchObject({ ok: false, code: 'ENGINE_ARGS_INVALID' })
    expect(engine.opGet('R1', { digits: 0 })).toMatchObject({ ok: false, code: 'ENGINE_ARGS_INVALID' })
    expect(engine.opGet('R1', { digits: 2.5 })).toMatchObject({ ok: false, code: 'ENGINE_ARGS_INVALID' })
    expect(engine.opGet('R1', { dim: 'bogus' })).toMatchObject({ ok: false, code: 'ENGINE_PARSE_UNIT' })
  })

  it('returns a value that set accepts again', () => {
    const read = engine.opGet('R1')
    expect(engine.opSet('R1_copy', read['value'])).toMatchObject({ ok: true, name: 'R1_copy', rev: 1 })
    expect(engine.opGet('R1_copy')['value']).toEqual(read['value'])
  })
})

describe('eval', () => {
  beforeEach(() => {
    openRecordWithConditions()
  })

  it('writes the target and returns only {ok, target, rev}', () => {
    const receipt = engine.opEval('@V_in/@R2', 'I')
    expect(receipt).toEqual({ ok: true, target: 'I', rev: 1 })
    const read = engine.opGet('I')
    expect(read['value']).toMatchObject({ dim: 'ampere' })
    expect((read['value'] as { num: number }).num).toBeCloseTo(12 / 220, 12)
  })

  it('requires the target slot name', () => {
    expect(engine.opEval('1+1', null)).toMatchObject({ ok: false, code: 'ENGINE_ARGS_INVALID' })
    expect(engine.opEval('1+1', '1x')).toMatchObject({ ok: false, code: 'ENGINE_PARSE_IDENT' })
    expect(engine.opEval(12 as unknown as string, 'x')).toMatchObject({ ok: false, code: 'ENGINE_ARGS_INVALID' })
  })

  it('refuses a fractional vector landing in a slot and leaves the slot unset', () => {
    engine.opSet('L', { num: 8, dim: 'metre' })
    expect(engine.opEval('@L^(1/3)', 'side')).toMatchObject({ ok: false, code: 'ENGINE_DIM_MISMATCH' })
    expect(engine.opGet('side')).toMatchObject({ ok: false, code: 'ENGINE_SLOT_UNDECLARED' })
  })

  it('counts the revisions of a rewritten target', () => {
    engine.opEval('@V_in/@R2', 'I')
    expect(engine.opEval('@V_in/@R2*2', 'I')).toEqual({ ok: true, target: 'I', rev: 2 })
  })
})

describe('the trace', () => {
  it('numbers the rows and stores the content each tool owns', () => {
    const id = openRecordWithConditions()
    engine.markerAnalyse('Ohm law on R2')
    engine.opEval('@V_in/@R2', 'I')
    engine.opGet('I')

    const rows = engine.readRows(id)
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3, 4, 5, 6])
    expect(rows.map((row) => row.tool)).toEqual(['record_question', 'set', 'set', 'record_analyse', 'eval', 'get'])
    expect(rows.every((row) => row.ok)).toBe(true)

    const question = rows[0]
    expect(question?.content['text']).toBe('What is the current through R2?')
    expect(question?.content['record']).toBe(id)

    const stored = rows[1]
    expect(stored?.content).toEqual({ name: 'V_in', value: { num: 12, dim: [2, 1, -3, -1, 0, 0, 0] } })

    const step = rows[4]
    expect(step?.content['formula']).toBe('@V_in/@R2')
    expect(step?.content['target']).toBe('I')
    expect(step?.content['rev']).toBe(1)
    expect(step?.content['vars']).toEqual({ V_in: { num: 12, dim: [2, 1, -3, -1, 0, 0, 0] }, R2: { num: 220, dim: [2, 1, -3, -2, 0, 0, 0] } })
    expect(step?.content['result']).toMatchObject({ dim: [0, 0, 0, 1, 0, 0, 0] })

    const read = rows[5]
    expect(read?.content['name']).toBe('I')
  })

  it('records a failure row with the code and the message only', () => {
    const id = openRecordWithConditions()
    engine.opEval('@V_in+@R2', 'P')
    const rows = engine.readRows(id)
    const failure = rows[rows.length - 1]
    expect(failure?.ok).toBe(false)
    expect(failure?.content['code']).toBe('ENGINE_DIM_MISMATCH')
    expect(Object.keys(failure?.content ?? {}).sort()).toEqual(['code', 'error'])
  })
})

describe('recovery', () => {
  it('replays the set and eval rows of the open record', () => {
    const id = openRecordWithConditions()
    engine.opEval('@V_in/@R2', 'I')

    const revived = new Engine(home, { now: () => clock })
    revived.start()
    expect(revived.openRecordId()).toBe(id)
    expect(revived.opGet('I')).toMatchObject({ ok: true, name: 'I' })
    const value = revived.opGet('I')['value'] as { num: number }
    expect(value.num).toBeCloseTo(12 / 220, 12)

    const rows = revived.readRows(id)
    expect(rows).toHaveLength(engine.readRows(id).length)
    const continued = revived.opEval('@I*2', 'I2')
    expect(continued).toMatchObject({ ok: true, target: 'I2', rev: 1 })
  })

  it('starts with no open record and an empty table when nothing is open', () => {
    engine.markerQuestion('q')
    engine.opSet('R1', { num: 1, dim: 'ohm' })
    engine.markerAnswer('a')
    const revived = new Engine(home, { now: () => clock })
    revived.start()
    expect(revived.openRecordId()).toBeNull()
    expect(revived.opGet('R1')).toMatchObject({ ok: false, code: 'ENGINE_NO_RECORD' })
  })
})

describe('the record files', () => {
  it('keeps the trace as one JSON line per row under the record id', () => {
    const id = openRecordWithConditions()
    const rows: TraceRow[] = engine.readRows(id)
    expect(rows).toHaveLength(3)
    expect(existsSync(join(home, 'records', `${id}.jsonl`))).toBe(true)
  })
})
