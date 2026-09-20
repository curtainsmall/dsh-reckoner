/**
 * Turn one stored trace into the facts the article prompt is built from.
 *
 * This is the seam between the engine's account of a calculation and the
 * generation prompt: the question, the values the user gave (as stored), the
 * analysis notes, one entry per successful `eval` with the formula that was
 * written, the slot values it substituted and its result, and the final answer.
 * Failed attempts are part of the engine's account but not of the solution, so
 * they are skipped here.
 */
import type { TraceRow } from './storage.ts'
import type { GenerationStep, Record } from '../generate.ts'

/** The record facts built from one trace. */
export function recordFacts(meta: { id: string; question: string }, rows: TraceRow[]): Record {
  const conditions: string[] = []
  const notes: string[] = []
  const steps: GenerationStep[] = []
  let answer = ''
  for (const row of rows) {
    if (row.ok !== true) continue
    if (row.tool === 'marker') {
      const text = typeof row.text === 'string' ? row.text.trim() : ''
      if (text.length === 0) continue
      if (row.kind === 'analyse') notes.push(text)
      else if (row.kind === 'answer') answer = text
      continue
    }
    if (row.tool === 'set') {
      const name = typeof row.name === 'string' ? row.name : ''
      if (row.deleted === true) conditions.push(`${name}: removed`)
      else conditions.push(`${name}: ${JSON.stringify(row.value)}`)
      continue
    }
    if (row.tool === 'eval' && typeof row.formula === 'string') {
      steps.push({
        seq: String(row.seq),
        formula: row.formula,
        vars: JSON.stringify(row.vars ?? {}),
        result: row.result === null || row.result === undefined ? '' : JSON.stringify(row.result),
      })
    }
  }
  const analyse = [
    conditions.length > 0 ? `Established conditions:\n${conditions.map((line) => `- ${line}`).join('\n')}` : '',
    ...notes,
  ].filter((line) => line.length > 0).join('\n\n')
  return { id: meta.id, question: meta.question, analyse, answer, steps }
}
