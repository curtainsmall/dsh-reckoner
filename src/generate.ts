/**
 * The article facts: one record reduced to what the generation step writes
 * from. Failed rows and `get` rows carry nothing to write, so they are
 * skipped; a `set` row that deletes a quantity removes it from the
 * conditions. What the article looks like is not the engine's business.
 */
import type { RecordIndexRow, TraceRow } from './engine/record.ts'

export interface GenerationCondition {
  readonly name: string
  readonly value: unknown
}

export interface GenerationStep {
  readonly seq: number
  readonly formula: string
  readonly vars: Record<string, unknown>
  readonly result: unknown
}

export interface GenerationFacts {
  readonly question: string
  readonly conditions: readonly GenerationCondition[]
  readonly analysis: readonly string[]
  readonly steps: readonly GenerationStep[]
  readonly answer: string | null
}

/** Reduce one record's trace to its facts. */
export function recordFacts(meta: RecordIndexRow, rows: readonly TraceRow[]): GenerationFacts {
  const conditions = new Map<string, unknown>()
  const analysis: string[] = []
  const steps: GenerationStep[] = []
  let answer: string | null = null

  for (const row of rows) {
    if (!row.ok) continue
    if (row.tool === 'set') {
      const name = row.content['name']
      if (typeof name !== 'string') continue
      const value = row.content['value'] ?? null
      if (value === null) conditions.delete(name)
      else conditions.set(name, value)
      continue
    }
    if (row.tool === 'record_analyse') {
      const text = row.content['text']
      if (typeof text === 'string') analysis.push(text)
      continue
    }
    if (row.tool === 'eval') {
      const formula = row.content['formula']
      if (typeof formula !== 'string') continue
      const vars = row.content['vars']
      steps.push({
        seq: row.seq,
        formula,
        vars: typeof vars === 'object' && vars !== null && !Array.isArray(vars) ? (vars as Record<string, unknown>) : {},
        result: row.content['result'] ?? null,
      })
      continue
    }
    if (row.tool === 'record_answer') {
      const text = row.content['text']
      if (typeof text === 'string') answer = text
    }
  }

  return {
    question: meta.question,
    conditions: [...conditions].map(([name, value]) => ({ name, value })),
    analysis,
    steps,
    answer,
  }
}
