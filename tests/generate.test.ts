import { describe, expect, it } from 'vitest'
import { recordFacts } from '../src/generate.ts'
import type { TraceRow } from '../src/engine/record.ts'

function row(seq: number, tool: TraceRow['tool'], content: Record<string, unknown>, ok = true): TraceRow {
  return { seq, at: 1000 + seq, tool, ok, content }
}

const ROWS: TraceRow[] = [
  row(1, 'record_start', { title: 'What is P?', record: '1' }),
  row(2, 'set', { name: 'V', value: { num: 12, dim: [2, 1, -3, -1, 0, 0, 0] } }),
  row(3, 'set', { name: 'R', value: { num: 100, dim: [2, 1, -3, -2, 0, 0, 0] } }),
  row(4, 'record_message', { text: 'Ohm law and P = V*I' }),
  row(5, 'record_message', { text: 'state the result in watt', hide: true }),
  row(6, 'eval', { formula: '@V/@R', target: 'I', rev: 1, vars: { V: 12, R: 100 }, result: { num: 0.12, dim: [0, 0, 0, 1, 0, 0, 0] } }),
  row(7, 'eval', { formula: '@V/@R', target: 'I2', rev: 1, vars: {}, result: null }, false),
  row(8, 'get', { name: 'I', value: { num: 0.12 } }),
  row(9, 'set', { name: 'R', value: null }),
  row(10, 'record_end', { text: 'P = 1.44 W', record: '1' }),
]

describe('article facts', () => {
  it('takes the title from the record_start row', () => {
    expect(recordFacts(ROWS).title).toBe('What is P?')
    expect(recordFacts([]).title).toBe('')
    expect(recordFacts([row(1, 'record_start', { record: '1' })]).title).toBe('')
    expect(recordFacts([row(1, 'record_start', { title: 'refused', record: '1' }, false)]).title).toBe('')
  })

  it('keeps the conditions that still stand, dropping a deleted one', () => {
    const facts = recordFacts(ROWS)
    expect(facts.conditions).toEqual([{ name: 'V', value: { num: 12, dim: [2, 1, -3, -1, 0, 0, 0] } }])
  })

  it('keeps the messages in order, each with its hide flag', () => {
    expect(recordFacts(ROWS).messages).toEqual([
      { seq: 4, text: 'Ohm law and P = V*I', hide: false },
      { seq: 5, text: 'state the result in watt', hide: true },
    ])
  })

  it('skips a refused message', () => {
    expect(recordFacts([row(1, 'record_message', { text: 'refused' }, false)]).messages).toEqual([])
    expect(recordFacts([]).messages).toEqual([])
  })

  it('keeps only the successful eval rows as steps', () => {
    const facts = recordFacts(ROWS)
    expect(facts.steps).toHaveLength(1)
    expect(facts.steps[0]).toEqual({
      seq: 6,
      formula: '@V/@R',
      vars: { V: 12, R: 100 },
      result: { num: 0.12, dim: [0, 0, 0, 1, 0, 0, 0] },
    })
    expect(recordFacts([row(1, 'eval', { formula: '@V/@R', target: 'I' })]).steps).toEqual([
      { seq: 1, formula: '@V/@R', vars: {}, result: null },
    ])
  })

  it('takes the closing text from the record_end row', () => {
    expect(recordFacts(ROWS).closing).toBe('P = 1.44 W')
    expect(recordFacts([row(1, 'record_end', { record: '1' })]).closing).toBeNull()
    expect(recordFacts([]).closing).toBeNull()
    expect(recordFacts([]).steps).toEqual([])
    expect(recordFacts([]).conditions).toEqual([])
  })

  it('keeps the last write of a rewritten condition', () => {
    const rows = [
      row(1, 'set', { name: 'R', value: { num: 100, dim: [2, 1, -3, -2, 0, 0, 0] } }),
      row(2, 'set', { name: 'R', value: { num: 220, dim: [2, 1, -3, -2, 0, 0, 0] } }),
    ]
    expect(recordFacts(rows).conditions).toEqual([{ name: 'R', value: { num: 220, dim: [2, 1, -3, -2, 0, 0, 0] } }])
  })

  it('skips a failed set row and a get row', () => {
    const rows = [
      row(1, 'set', { name: 'R', value: { num: 1 } }, false),
      row(2, 'get', { name: 'R', value: { num: 1 } }),
    ]
    const facts = recordFacts(rows)
    expect(facts.conditions).toEqual([])
    expect(facts.steps).toEqual([])
    expect(facts.messages).toEqual([])
  })
})
