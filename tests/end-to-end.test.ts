import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Engine } from '../src/engine/engine.ts'
import { buildArticlePrompt, recordFacts } from '../src/generate.ts'
import type { TraceRow } from '../src/engine/record.ts'
import { createEngineTools } from '../src/tools/engine-tools.ts'

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

/** The rows of one record; throws when the record does not exist. */
function rowsOf(id: string): TraceRow[] {
  const record = engine.readRecordRows(id)
  if (record === null) throw new Error(`no record "${id}"`)
  return record.rows
}

/** One complete record, from the title to the closing text, the way the model drives it. */
function solveTheRecord(): { id: string; series: Record<string, unknown>; current: Record<string, unknown> } {
  engine.markerStart('The current through two series resistors')
  engine.opSet('V_in', { num: 12, dim: 'volt' })
  engine.opSet('R1', { num: 4700, dim: 'ohm' })
  engine.opSet('R2', { num: 220, dim: 'ohm' })
  engine.markerMessage('Ohm law: I = V_in / (R1 + R2)', undefined)
  engine.opEval('@R1+@R2', 'R_series')
  engine.opEval('@V_in/@R_series', 'I')
  const series = engine.opGet('R_series')
  const current = engine.opGet('I', { digits: 4 })
  engine.markerEnd('I = 2.439 mA')
  const id = engine.listRecords().rows[0]?.id
  if (id === undefined) throw new Error('the record was not written')
  return { id, series, current }
}

describe('a whole record', () => {
  it('evaluates step by step and keeps every receipt usable', () => {
    const { id, series, current } = solveTheRecord()
    expect(engine.openRecordId()).toBeNull()

    expect(series['value']).toEqual({ num: 4920, dim: 'ohm' })

    const value = current['value'] as { num: number; dim: string }
    expect(value.num).toBeCloseTo(0.002439, 6)
    expect(value.dim).toBe('ampere')

    const facts = recordFacts(rowsOf(id))
    expect(facts.title).toBe('The current through two series resistors')
    expect(facts.conditions).toHaveLength(3)
    expect(facts.messages.map((message) => message.text)).toEqual(['Ohm law: I = V_in / (R1 + R2)'])
    expect(facts.steps.map((step) => step.formula)).toEqual(['@R1+@R2', '@V_in/@R_series'])
    expect(facts.steps[1]?.result).toMatchObject({ dim: [0, 0, 0, 1, 0, 0, 0] })
    expect(facts.closing).toBe('I = 2.439 mA')
  })

  it('stores values and SI vectors on disk, never a unit name', () => {
    const { id } = solveTheRecord()
    const rows = rowsOf(id).filter((row) => row.tool === 'set' || row.tool === 'eval')
    expect(rows).toHaveLength(5)
    const text = rows.map((row) => JSON.stringify(row.content)).join('\n')
    for (const name of ['ohm', 'volt', 'ampere', 'dim-less', 'radian']) {
      expect(text).not.toContain(name)
    }
    expect(text).toContain('[2,1,-3,-2,0,0,0]')

    // Header line first, one JSON line per trace row, the closing row last.
    const lines = readFileSync(join(home, 'records', `${id}.jsonl`), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(11)
    expect(JSON.parse(lines[0]!)).toEqual({ seq: 0, version: 1 })
    expect(lines.slice(1).map((line) => (JSON.parse(line) as TraceRow).seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(JSON.parse(lines[lines.length - 1]!)).toMatchObject({ tool: 'record_end', ok: true, content: { record: id } })
    expect(existsSync(join(home, 'open-record.jsonl'))).toBe(false)
  })

  it("carries a hidden message into the article prompt's author's notes", () => {
    engine.markerStart('A simple divider')
    engine.opSet('V_in', { num: 12, dim: 'volt' })
    engine.markerMessage('The current is what the reader wants.', true)
    engine.markerMessage('Ohm law gives I = V / R.', undefined)
    engine.opEval('@V_in/@V_in', 'ratio')
    engine.markerEnd('done')

    const id = String(engine.listRecords().rows[0]?.id)
    const facts = recordFacts(rowsOf(id))
    expect(facts.messages.map((message) => message.hide)).toEqual([true, false])

    const prompt = buildArticlePrompt(facts)
    const notesAt = prompt.user.indexOf("The author's notes below")
    expect(notesAt).toBeGreaterThan(-1)
    expect(prompt.user.indexOf('The current is what the reader wants.')).toBeGreaterThan(notesAt)
    expect(prompt.user.indexOf('Ohm law gives I = V / R.')).toBeLessThan(notesAt)
  })

  it('exposes the six tools the record protocol uses', () => {
    const names = createEngineTools(engine).map((tool) => (tool as unknown as { name: string }).name)
    expect(names).toEqual(['set', 'get', 'eval', 'record_start', 'record_message', 'record_end'])
  })
})
