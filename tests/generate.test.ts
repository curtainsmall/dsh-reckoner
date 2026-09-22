import { describe, expect, it } from 'vitest'
import { recordFacts } from '../src/generate.ts'
import type { RecordIndexRow, TraceRow } from '../src/engine/record.ts'

const META: RecordIndexRow = { id: '1', question: 'What is P?', openedAt: 10, answeredAt: 20 }

function row(seq: number, tool: TraceRow['tool'], content: Record<string, unknown>, ok = true): TraceRow {
  return { seq, at: 1000 + seq, tool, ok, content }
}

const ROWS: TraceRow[] = [
  row(1, 'record_question', { text: 'What is P?', record: '1' }),
  row(2, 'set', { name: 'V', value: { num: 12, dim: [2, 1, -3, -1, 0, 0, 0] } }),
  row(3, 'set', { name: 'R', value: { num: 100, dim: [2, 1, -3, -2, 0, 0, 0] } }),
  row(4, 'record_analyse', { text: 'Ohm law and P = V*I' }),
  row(5, 'eval', { formula: '@V/@R', target: 'I', rev: 1, vars: { V: 12, R: 100 }, result: { num: 0.12, dim: [0, 0, 0, 1, 0, 0, 0] } }),
  row(6, 'eval', { formula: '@V/@R', target: 'I2', rev: 1, vars: {}, result: null }, false),
  row(7, 'get', { name: 'I', value: { num: 0.12 } }),
  row(8, 'set', { name: 'R', value: null }),
  row(9, 'record_answer', { text: 'P = 1.44 W', record: '1' }),
]

describe('article facts', () => {
  it('takes the question from the index row', () => {
    expect(recordFacts(META, ROWS).question).toBe('What is P?')
  })

  it('keeps the conditions that still stand, dropping a deleted one', () => {
    const facts = recordFacts(META, ROWS)
    expect(facts.conditions).toEqual([{ name: 'V', value: { num: 12, dim: [2, 1, -3, -1, 0, 0, 0] } }])
  })

  it('collects every analysis text', () => {
    expect(recordFacts(META, ROWS).analysis).toEqual(['Ohm law and P = V*I'])
  })

  it('keeps only the successful eval rows as steps', () => {
    const facts = recordFacts(META, ROWS)
    expect(facts.steps).toHaveLength(1)
    expect(facts.steps[0]).toEqual({
      seq: 5,
      formula: '@V/@R',
      vars: { V: 12, R: 100 },
      result: { num: 0.12, dim: [0, 0, 0, 1, 0, 0, 0] },
    })
  })

  it('takes the answer from the answering row', () => {
    expect(recordFacts(META, ROWS).answer).toBe('P = 1.44 W')
    expect(recordFacts(META, []).answer).toBeNull()
    expect(recordFacts(META, []).steps).toEqual([])
    expect(recordFacts(META, []).conditions).toEqual([])
  })

  it('keeps the last write of a rewritten condition', () => {
    const rows = [
      row(1, 'set', { name: 'R', value: { num: 100, dim: [2, 1, -3, -2, 0, 0, 0] } }),
      row(2, 'set', { name: 'R', value: { num: 220, dim: [2, 1, -3, -2, 0, 0, 0] } }),
    ]
    expect(recordFacts(META, rows).conditions).toEqual([{ name: 'R', value: { num: 220, dim: [2, 1, -3, -2, 0, 0, 0] } }])
  })

  it('skips a failed set row', () => {
    const rows = [row(1, 'set', { name: 'R', value: { num: 1 } }, false)]
    expect(recordFacts(META, rows).conditions).toEqual([])
  })
})
