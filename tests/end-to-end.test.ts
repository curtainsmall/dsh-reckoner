import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Engine } from '../src/engine/engine.ts'
import { recordFacts } from '../src/generate.ts'
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

/** One complete record, from the question to the answer, the way the model drives it. */
function solveTheQuestion(): { id: string; series: Record<string, unknown>; current: Record<string, unknown> } {
  engine.markerQuestion('A 12 V source feeds R1 and R2 in series. What is the current?')
  engine.opSet('V_in', { num: 12, dim: 'volt' })
  engine.opSet('R1', { num: 4700, dim: 'ohm' })
  engine.opSet('R2', { num: 220, dim: 'ohm' })
  engine.markerAnalyse('Ohm law: I = V_in / (R1 + R2)')
  engine.opEval('@R1+@R2', 'R_series')
  engine.opEval('@V_in/@R_series', 'I')
  const series = engine.opGet('R_series')
  const current = engine.opGet('I', { digits: 4 })
  engine.markerAnswer('I = 2.439 mA')
  const id = engine.indexRows()[0]?.id
  if (id === undefined) throw new Error('the record was not indexed')
  return { id, series, current }
}

describe('a whole record', () => {
  it('evaluates step by step and keeps every receipt usable', () => {
    const { id, series, current } = solveTheQuestion()
    expect(engine.openRecordId()).toBeNull()

    expect(series['value']).toEqual({ num: 4920, dim: 'ohm' })

    const value = current['value'] as { num: number; dim: string }
    expect(value.num).toBeCloseTo(0.002439, 6)
    expect(value.dim).toBe('ampere')

    const facts = recordFacts({ id, question: 'q', openedAt: 1, answeredAt: 2 }, engine.readRows(id))
    expect(facts.conditions).toHaveLength(3)
    expect(facts.analysis).toHaveLength(1)
    expect(facts.steps.map((step) => step.formula)).toEqual(['@R1+@R2', '@V_in/@R_series'])
    expect(facts.steps[1]?.result).toMatchObject({ dim: [0, 0, 0, 1, 0, 0, 0] })
    expect(facts.answer).toBe('I = 2.439 mA')
  })

  it('stores values and SI vectors on disk, never a unit name', () => {
    const { id } = solveTheQuestion()
    const rows: TraceRow[] = engine.readRows(id).filter((row) => row.tool === 'set' || row.tool === 'eval')
    expect(rows).toHaveLength(5)
    const text = rows.map((row) => JSON.stringify(row.content)).join('\n')
    for (const name of ['ohm', 'volt', 'ampere', 'dim-less', 'radian']) {
      expect(text).not.toContain(name)
    }
    expect(text).toContain('[2,1,-3,-2,0,0,0]')
    expect(readFileSync(join(home, 'records', `${id}.jsonl`), 'utf8').trim().split('\n')).toHaveLength(10)
  })

  it('exposes the six tools the record protocol uses', () => {
    const names = createEngineTools(engine).map((tool) => (tool as unknown as { name: string }).name)
    expect(names).toEqual(['set', 'get', 'eval', 'record_question', 'record_analyse', 'record_answer'])
  })
})
