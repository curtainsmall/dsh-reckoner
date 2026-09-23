import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Engine } from '../src/engine/engine.ts'
import { RECORD_VERSION, type TraceRow } from '../src/engine/record.ts'

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

/** The rows of one record, open or closed; throws when the record does not exist. */
function rowsOf(target: Engine, id: string): TraceRow[] {
  const record = target.readRecordRows(id)
  if (record === null) throw new Error(`no record "${id}"`)
  return record.rows
}

/** The lines of one closed record file. */
function recordLines(id: string): string[] {
  return readFileSync(join(home, 'records', `${id}.jsonl`), 'utf8').trim().split('\n')
}

/** A record open and holding the two conditions of a simple divider. */
function openRecordWithConditions(): string {
  engine.markerStart('The current through R2')
  engine.opSet('V_in', { num: 12, dim: 'volt' })
  engine.opSet('R2', { num: 220, dim: 'ohm' })
  const id = engine.openRecordId()
  if (id === null) throw new Error('the record did not open')
  return id
}

describe('the record gate', () => {
  it('refuses set, get and eval while no record is open', () => {
    expect(engine.opSet('R1', { num: 1, dim: 'ohm' })).toMatchObject({ ok: false, code: 'ENGINE_OPEN_RECORD_NOT_FOUND' })
    expect(engine.opGet('R1')).toMatchObject({ ok: false, code: 'ENGINE_OPEN_RECORD_NOT_FOUND' })
    expect(engine.opEval('1+1', 'x')).toMatchObject({ ok: false, code: 'ENGINE_OPEN_RECORD_NOT_FOUND' })
    expect(engine.markerMessage('a message', undefined)).toMatchObject({ ok: false, code: 'ENGINE_OPEN_RECORD_NOT_FOUND' })
    expect(existsSync(join(home, 'open-record.jsonl'))).toBe(false)
    expect(existsSync(join(home, 'record-index.jsonl'))).toBe(false)
    expect(existsSync(join(home, 'records'))).toBe(false)
  })

  it('fails a marker with self-sufficient text', () => {
    const receipt = engine.opSet('R1', { num: 1 })
    expect(typeof receipt['error']).toBe('string')
    expect(String(receipt['error'])).toContain('record_start')
  })
})

describe('the record markers', () => {
  it('opens a record, reports it as the open one and answers with {ok}', () => {
    expect(engine.markerStart('The current through R2')).toEqual({ ok: true })
    const id = engine.openRecordId()
    expect(typeof id).toBe('string')
    const listing = engine.listRecords()
    expect(listing.rows).toEqual([])
    expect(listing.unknownIds).toEqual([])
    expect(listing.open?.id).toBe(id)
    expect(listing.open?.title).toBe('The current through R2')
    expect(typeof listing.open?.openedAt).toBe('number')

    expect(engine.markerMessage('Ohm law on R2', undefined)).toEqual({ ok: true })
    expect(engine.markerEnd('the answer')).toEqual({ ok: true })
    expect(engine.openRecordId()).toBeNull()
    const closed = engine.listRecords()
    expect(closed.rows.map((row) => row.id)).toEqual([String(id)])
    expect(closed.rows[0]?.title).toBe('The current through R2')
    expect(typeof closed.rows[0]?.endedAt).toBe('number')
  })

  it('clears the slot table when the record closes, so the next record starts empty', () => {
    engine.markerStart('first')
    engine.opSet('R1', { num: 1, dim: 'ohm' })
    engine.markerEnd('done')
    // The table lives exactly as long as the record: with it closed there is nothing to read.
    expect(engine.opGet('R1')).toMatchObject({ ok: false, code: 'ENGINE_OPEN_RECORD_NOT_FOUND' })
    engine.markerStart('second')
    expect(engine.opGet('R1')).toMatchObject({ ok: false, code: 'ENGINE_SLOT_NOT_FOUND' })
    expect(engine.opSet('R1', { num: 2, dim: 'ohm' })['rev']).toBe(1)
  })

  it('refuses record_start with an empty or non-string title', () => {
    expect(engine.markerStart('')).toMatchObject({ ok: false, code: 'ENGINE_INVALID_ARGS' })
    expect(engine.markerStart('   ')).toMatchObject({ ok: false, code: 'ENGINE_INVALID_ARGS' })
    expect(engine.markerStart(42)).toMatchObject({ ok: false, code: 'ENGINE_INVALID_ARGS' })
    expect(engine.openRecordId()).toBeNull()
    expect(existsSync(join(home, 'open-record.jsonl'))).toBe(false)
  })

  it('refuses a second record_start while a record is open, and records the failure in it', () => {
    const id = openRecordWithConditions()
    const receipt = engine.markerStart('another')
    expect(receipt).toMatchObject({ ok: false, code: 'ENGINE_OPEN_RECORD_FOUND' })
    expect(String(receipt['error'])).toContain('record_end')
    expect(engine.openRecordId()).toBe(id)

    const rows = rowsOf(engine, id)
    const last = rows[rows.length - 1]
    expect(last?.tool).toBe('record_start')
    expect(last?.ok).toBe(false)
    expect(Object.keys(last?.content ?? {}).sort()).toEqual(['code', 'error'])
    expect(last?.content['code']).toBe('ENGINE_OPEN_RECORD_FOUND')

    // The refused call opened nothing: closing writes exactly one record.
    engine.markerEnd('done')
    expect(engine.listRecords().rows.map((row) => row.id)).toEqual([id])
  })

  it('refuses record_message with an empty text or a non-boolean hide', () => {
    const id = openRecordWithConditions()
    expect(engine.markerMessage('', undefined)).toMatchObject({ ok: false, code: 'ENGINE_INVALID_ARGS' })
    expect(engine.markerMessage(12, undefined)).toMatchObject({ ok: false, code: 'ENGINE_INVALID_ARGS' })
    expect(engine.markerMessage('a note', 'yes')).toMatchObject({ ok: false, code: 'ENGINE_INVALID_ARGS' })

    const rows = rowsOf(engine, id)
    expect(rows.filter((row) => row.tool === 'record_message' && row.ok)).toEqual([])
    expect(rows.filter((row) => !row.ok).map((row) => row.content['code'])).toEqual([
      'ENGINE_INVALID_ARGS',
      'ENGINE_INVALID_ARGS',
      'ENGINE_INVALID_ARGS',
    ])
  })

  it('refuses record_end with no record open and writes nothing', () => {
    expect(engine.markerEnd('nothing')).toMatchObject({ ok: false, code: 'ENGINE_OPEN_RECORD_NOT_FOUND' })
    expect(engine.listRecords()).toMatchObject({ rows: [], open: null, unknownIds: [] })
    expect(existsSync(join(home, 'open-record.jsonl'))).toBe(false)
    expect(existsSync(join(home, 'records'))).toBe(false)
  })

  it('refuses a non-string closing text and keeps the record open', () => {
    const id = openRecordWithConditions()
    expect(engine.markerEnd(42)).toMatchObject({ ok: false, code: 'ENGINE_INVALID_ARGS' })
    expect(engine.openRecordId()).toBe(id)
    const last = rowsOf(engine, id).at(-1)
    expect(last?.tool).toBe('record_end')
    expect(last?.ok).toBe(false)
    expect(existsSync(join(home, 'open-record.jsonl'))).toBe(true)
  })

  it('accepts a blank closing text as no closing text', () => {
    engine.markerStart('blank close')
    const id = String(engine.openRecordId())
    expect(engine.markerEnd('   ')).toEqual({ ok: true })
    expect(engine.openRecordId()).toBeNull()
    const last = rowsOf(engine, id).at(-1)
    expect(last?.content).toEqual({ record: id })
  })
})

describe('set', () => {
  beforeEach(() => {
    engine.markerStart('q')
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
    expect(engine.opSet('1x', { num: 1 })).toMatchObject({ ok: false, code: 'ENGINE_INVALID_IDENTIFIER' })
    expect(engine.opSet('R1', { num: 1, dim: 'bogus' })).toMatchObject({ ok: false, code: 'ENGINE_INVALID_DIMENSION' })
    expect(engine.opSet('R1', { num: 1, array: [1] })).toMatchObject({ ok: false, code: 'ENGINE_INVALID_ARGS' })
    expect(engine.opGet('R1')).toMatchObject({ ok: false, code: 'ENGINE_SLOT_NOT_FOUND' })
  })
})

describe('get', () => {
  beforeEach(() => {
    engine.markerStart('q')
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
    expect(engine.opGet('R1', { dim: 'volt' })).toMatchObject({ ok: false, code: 'ENGINE_INCOMPATIBLE_DIMENSION' })
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
    expect(engine.opGet('missing')).toMatchObject({ ok: false, code: 'ENGINE_SLOT_NOT_FOUND' })
    expect(engine.opGet('R1', { form: 'json' })).toMatchObject({ ok: false, code: 'ENGINE_INVALID_ARGS' })
    expect(engine.opGet('R1', { digits: 0 })).toMatchObject({ ok: false, code: 'ENGINE_INVALID_ARGS' })
    expect(engine.opGet('R1', { digits: 2.5 })).toMatchObject({ ok: false, code: 'ENGINE_INVALID_ARGS' })
    expect(engine.opGet('R1', { dim: 'bogus' })).toMatchObject({ ok: false, code: 'ENGINE_INVALID_DIMENSION' })
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
    expect(engine.opEval('1+1', null)).toMatchObject({ ok: false, code: 'ENGINE_INVALID_ARGS' })
    expect(engine.opEval('1+1', '1x')).toMatchObject({ ok: false, code: 'ENGINE_INVALID_IDENTIFIER' })
    expect(engine.opEval(12 as unknown as string, 'x')).toMatchObject({ ok: false, code: 'ENGINE_INVALID_ARGS' })
  })

  it('refuses a fractional vector landing in a slot and leaves the slot unset', () => {
    engine.opSet('L', { num: 8, dim: 'metre' })
    expect(engine.opEval('@L^(1/3)', 'side')).toMatchObject({ ok: false, code: 'ENGINE_INCOMPATIBLE_DIMENSION' })
    expect(engine.opGet('side')).toMatchObject({ ok: false, code: 'ENGINE_SLOT_NOT_FOUND' })
  })

  it('counts the revisions of a rewritten target', () => {
    engine.opEval('@V_in/@R2', 'I')
    expect(engine.opEval('@V_in/@R2*2', 'I')).toEqual({ ok: true, target: 'I', rev: 2 })
  })
})

describe('the trace', () => {
  it('numbers the rows and stores the content each tool owns', () => {
    const id = openRecordWithConditions()
    engine.markerMessage('Ohm law on R2', undefined)
    engine.opEval('@V_in/@R2', 'I')
    engine.opGet('I')

    const rows = rowsOf(engine, id)
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3, 4, 5, 6])
    expect(rows.map((row) => row.tool)).toEqual(['record_start', 'set', 'set', 'record_message', 'eval', 'get'])
    expect(rows.every((row) => row.ok)).toBe(true)

    const opened = rows[0]
    expect(opened?.content['title']).toBe('The current through R2')
    expect(opened?.content['record']).toBe(id)

    const stored = rows[1]
    expect(stored?.content).toEqual({ name: 'V_in', value: { num: 12, dim: [2, 1, -3, -1, 0, 0, 0] } })

    const message = rows[3]
    expect(message?.content).toEqual({ text: 'Ohm law on R2' })

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
    const rows = rowsOf(engine, id)
    const failure = rows[rows.length - 1]
    expect(failure?.ok).toBe(false)
    expect(failure?.content['code']).toBe('ENGINE_INCOMPATIBLE_DIMENSION')
    expect(Object.keys(failure?.content ?? {}).sort()).toEqual(['code', 'error'])
  })

  it('keeps the hide flag of a message and nothing else', () => {
    const id = openRecordWithConditions()
    engine.markerMessage('I = 54.5 mA', undefined)
    engine.markerMessage('use the amplitude convention: 20', true)

    const messages = rowsOf(engine, id).filter((row) => row.tool === 'record_message')
    expect(messages.map((row) => row.content)).toEqual([
      { text: 'I = 54.5 mA' },
      { text: 'use the amplitude convention: 20', hide: true },
    ])
  })
})

describe('the record files', () => {
  it('keeps the unclosed record in open-record.jsonl and moves it into records/ when it closes', () => {
    const id = openRecordWithConditions()
    const openFile = join(home, 'open-record.jsonl')
    expect(existsSync(openFile)).toBe(true)
    expect(readFileSync(openFile, 'utf8').split('\n')[0]).toBe(JSON.stringify({ seq: 0, version: RECORD_VERSION }))
    // Nothing is closed yet, so records/ holds nothing at all.
    expect(existsSync(join(home, 'records'))).toBe(false)

    engine.markerMessage('Ohm law', undefined)
    engine.opEval('@V_in/@R2', 'I')
    engine.markerEnd('I = 54.5 mA')

    expect(existsSync(openFile)).toBe(false)
    expect(readdirSync(join(home, 'records'))).toEqual([`${id}.jsonl`])
    expect(existsSync(join(home, 'record-index.jsonl'))).toBe(false)
  })

  it('writes the header first, the closing row last and one JSON line per row', () => {
    const id = openRecordWithConditions()
    engine.markerMessage('Ohm law', undefined)
    engine.opEval('@V_in/@R2', 'I')
    engine.markerEnd('I = 54.5 mA')

    const lines = recordLines(id)
    const rows = rowsOf(engine, id)
    expect(lines).toHaveLength(rows.length + 1)
    expect(JSON.parse(lines[0]!)).toEqual({ seq: 0, version: RECORD_VERSION })
    expect(JSON.parse(lines[lines.length - 1]!)).toMatchObject({
      seq: rows.length,
      tool: 'record_end',
      ok: true,
      content: { text: 'I = 54.5 mA', record: id },
    })
    expect(lines.slice(1).map((line) => (JSON.parse(line) as TraceRow).seq)).toEqual(rows.map((row) => row.seq))
  })

  it('reads the rows of the open record by its id', () => {
    const id = openRecordWithConditions()
    const record = engine.readRecordRows(id)
    expect(record?.version).toBe(RECORD_VERSION)
    expect(record?.rows.map((row) => row.tool)).toEqual(['record_start', 'set', 'set'])
    expect(engine.summarize(id)).toMatchObject({ title: 'The current through R2' })
  })
})

describe('the roster', () => {
  it('lists the closed records newest first with their titles and span', () => {
    engine.markerStart('first')
    const first = String(engine.openRecordId())
    engine.markerEnd('done')
    engine.markerStart('second')
    const second = String(engine.openRecordId())
    engine.markerEnd(undefined)

    const listing = engine.listRecords()
    expect(listing.open).toBeNull()
    expect(listing.unknownIds).toEqual([])
    expect(listing.rows.map((row) => row.id)).toEqual([second, first])
    expect(listing.rows.map((row) => row.title)).toEqual(['second', 'first'])
    expect(listing.rows.every((row) => row.version === RECORD_VERSION)).toBe(true)
    expect(typeof listing.rows[0]?.openedAt).toBe('number')
    expect(typeof listing.rows[0]?.endedAt).toBe('number')
    expect(listing.rows[0]!.endedAt).toBeGreaterThanOrEqual(listing.rows[0]!.openedAt)
  })

  it('suffixes a record created in the same millisecond as another', () => {
    const frozen = new Engine(home, { now: () => 1_700_000_000_000 })
    frozen.start()
    frozen.markerStart('one')
    const first = String(frozen.openRecordId())
    frozen.markerEnd(undefined)
    frozen.markerStart('two')
    const second = String(frozen.openRecordId())
    frozen.markerEnd(undefined)

    expect(first).toBe('1700000000000')
    expect(second).toBe('1700000000000-2')
    expect(frozen.listRecords().rows.map((row) => row.id)).toEqual([second, first])
  })

  it('counts a headerless file as unknown and never lists or serves it', () => {
    engine.markerStart('a real record')
    const id = String(engine.openRecordId())
    engine.markerEnd(undefined)

    mkdirSync(join(home, 'records'), { recursive: true })
    writeFileSync(
      join(home, 'records', '999.jsonl'),
      [
        JSON.stringify({ seq: 1, at: 1, tool: 'record_start', ok: true, content: { title: 'no header', record: '999' } }),
        JSON.stringify({ seq: 2, at: 2, tool: 'record_end', ok: true, content: { record: '999' } }),
      ].join('\n') + '\n',
      'utf8',
    )

    const listing = engine.listRecords()
    expect(listing.rows.map((row) => row.id)).toEqual([id])
    expect(listing.unknownIds).toHaveLength(1)
    expect(engine.readRecordRows('999')).toBeNull()
    expect(engine.summarize('999')).toBeNull()
  })

  it('counts a file written by an older record version as unknown', () => {
    mkdirSync(join(home, 'records'), { recursive: true })
    writeFileSync(
      join(home, 'records', '404.jsonl'),
      [
        JSON.stringify({ seq: 0, version: RECORD_VERSION - 1 }),
        JSON.stringify({ seq: 1, at: 1, tool: 'record_start', ok: true, content: { title: 'old', record: '404' } }),
        JSON.stringify({ seq: 2, at: 2, tool: 'record_end', ok: true, content: { record: '404' } }),
      ].join('\n') + '\n',
      'utf8',
    )

    const listing = engine.listRecords()
    expect(listing.rows).toEqual([])
    expect(listing.unknownIds).toHaveLength(1)
    expect(engine.readRecordRows('404')).toBeNull()
  })

  it('removes a closed record from the roster and from the disk', () => {
    engine.markerStart('gone')
    const id = String(engine.openRecordId())
    engine.markerEnd(undefined)
    expect(engine.listRecords().rows.map((row) => row.id)).toEqual([id])

    engine.deleteRecord(id)
    expect(engine.listRecords().rows).toEqual([])
    expect(existsSync(join(home, 'records', `${id}.jsonl`))).toBe(false)
  })
})

describe('recovery', () => {
  it('resumes the unclosed record and replays its set and eval rows', () => {
    const id = openRecordWithConditions()
    engine.opEval('@V_in/@R2', 'I')

    const revived = new Engine(home, { now: () => clock })
    revived.start()
    expect(revived.openRecordId()).toBe(id)
    expect(revived.readRecordRows(id)?.rows).toHaveLength(rowsOf(engine, id).length)
    const read = revived.opGet('I')
    expect(read).toMatchObject({ ok: true, name: 'I' })
    expect((read['value'] as { num: number }).num).toBeCloseTo(12 / 220, 12)

    // The resumed record is still the one that closes: its rows are continued, not restarted.
    expect(revived.opEval('@I*2', 'I2')).toMatchObject({ ok: true, target: 'I2', rev: 1 })
    const before = rowsOf(engine, id).length
    expect(revived.markerEnd('done')).toEqual({ ok: true })
    expect(revived.readRecordRows(id)?.rows).toHaveLength(before + 1)
    expect(revived.listRecords().rows.map((row) => row.id)).toEqual([id])
  })

  it('starts empty when nothing was left open', () => {
    engine.markerStart('q')
    engine.opSet('R1', { num: 1, dim: 'ohm' })
    engine.markerEnd('a')
    const revived = new Engine(home, { now: () => clock })
    revived.start()
    expect(revived.openRecordId()).toBeNull()
    expect(revived.opGet('R1')).toMatchObject({ ok: false, code: 'ENGINE_OPEN_RECORD_NOT_FOUND' })
    expect(revived.listRecords().rows).toHaveLength(1)
  })

  it('discards an unreadable open-record.jsonl', () => {
    const openFile = join(home, 'open-record.jsonl')
    writeFileSync(
      openFile,
      `${JSON.stringify({ seq: 1, at: 1, tool: 'set', ok: true, content: { name: 'R1', value: { num: 1 } } })}\n`,
      'utf8',
    )

    const revived = new Engine(home, { now: () => clock })
    revived.start()
    expect(revived.openRecordId()).toBeNull()
    expect(existsSync(openFile)).toBe(false)
    expect(revived.opSet('R1', { num: 1 })).toMatchObject({ ok: false, code: 'ENGINE_OPEN_RECORD_NOT_FOUND' })
    expect(revived.listRecords()).toMatchObject({ rows: [], open: null, unknownIds: [] })
  })

  it('discards an open-record.jsonl written by an older version', () => {
    const openFile = join(home, 'open-record.jsonl')
    writeFileSync(
      openFile,
      [
        JSON.stringify({ seq: 0, version: RECORD_VERSION - 1 }),
        JSON.stringify({ seq: 1, at: 1, tool: 'record_start', ok: true, content: { title: 'old', record: '5' } }),
      ].join('\n') + '\n',
      'utf8',
    )

    const revived = new Engine(home, { now: () => clock })
    revived.start()
    expect(revived.openRecordId()).toBeNull()
    expect(existsSync(openFile)).toBe(false)
  })
})
