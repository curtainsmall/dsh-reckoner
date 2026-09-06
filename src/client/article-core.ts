/**
 * ElectroLab record → article narrative core.
 *
 * Walks one record body once and produces a language-neutral list of
 * narrative blocks (analysis texts, given conditions, calculations, drops,
 * conclusion) in trace order. Renderers (Markdown / LaTeX) turn the blocks
 * into their own formats, so the step logic and the "previous result becomes
 * the next analysis premise" handover live in exactly one place.
 */
import { displayValue } from './ui.tsx'

/** Minimal structural view of a record body (rows carry an index signature). */
export interface ArticleSource {
  id: string
  question: string
  rows: Array<Record<string, unknown>>
}

/** A single named result or condition handed from one step to the next. */
export interface NamedValue {
  name: string
  value: unknown
}

/** One narrative block of a solution article. */
export type NarrativeBlock =
  | { kind: 'analysis'; text: string; premise?: NamedValue }
  | { kind: 'given'; name: string; value: unknown }
  | { kind: 'drop'; name: string }
  | { kind: 'calculation'; solver: string; inputs: Array<[string, unknown]>; target?: string; result?: unknown }
  | { kind: 'conclusion'; text: string }

/** What a whole record yields: the question plus its narrative blocks in order. */
export interface Narrative {
  question: string
  blocks: NarrativeBlock[]
}

/** Whether a value is a scalar typed value (inline text) rather than structured JSON. */
export function isScalarValue(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return true
  const v = value as Record<string, unknown>
  return v.type === 'number' || v.type === 'complex' || v.type === 'string' || v.type === 'boolean' || v.type === 'slot'
}

/** The raw payload of a structured value (typed object/array unwrap to their inner value). */
export function innerOf(value: unknown): unknown {
  if (value !== null && typeof value === 'object') {
    const v = value as Record<string, unknown>
    if ((v.type === 'object' || v.type === 'array') && typeof v.value === 'object' && v.value !== null) return v.value
  }
  return value
}

/** Human display of a value (units and prefixes applied) — shared by the renderers. */
export function humanOf(value: unknown): string {
  return displayValue(value)
}

/** Build the narrative: question resolution plus ordered narrative blocks. */
export function narrativeOf(body: ArticleSource): Narrative {
  const blocks: NarrativeBlock[] = []
  // Named values established so far (used only to resolve premise names).
  const known = new Map<string, unknown>()
  // The most recent result, reused as the premise of the next analysis block.
  let lastResult: NamedValue | undefined

  const questionText = body.question.trim()
  const questionRows = body.rows.filter((row) => row.tool === 'marker' && row.kind === 'question')
  const question = questionText.length > 0
    ? questionText
    : typeof questionRows[0]?.text === 'string' ? questionRows[0]!.text as string : body.id

  for (const row of body.rows) {
    if (row.ok !== true) continue
    const tool = row.tool
    if (tool === 'solver_info') continue
    if (tool === 'marker') {
      const kind = row.kind
      if (kind === 'answer') {
        const text = typeof row.text === 'string' ? row.text.trim() : ''
        if (text.length > 0) blocks.push({ kind: 'conclusion', text })
      } else if (kind === 'analyse') {
        const text = typeof row.text === 'string' ? row.text.trim() : ''
        if (text.length > 0) {
          blocks.push({ kind: 'analysis', text, premise: lastResult })
          // The premise has been used; it no longer needs a dedicated lead-in.
          lastResult = undefined
        }
      }
      // question markers are consumed by the problem header; duplicate markers stay silent.
      continue
    }
    if (tool === 'set') {
      const name = typeof row.name === 'string' ? row.name : ''
      if (row.deleted === true) {
        known.delete(name)
        blocks.push({ kind: 'drop', name })
        continue
      }
      known.set(name, row.value)
      lastResult = { name, value: row.value }
      blocks.push({ kind: 'given', name, value: row.value })
      continue
    }
    if (tool === 'call') {
      const solver = typeof row.solver === 'string' ? row.solver : 'call'
      const resolved = row.resolved as Record<string, unknown> | undefined
      const args = row.args as Record<string, unknown> | undefined
      const source = resolved ?? args
      const inputs = source === undefined
        ? []
        : Object.entries(source).filter(([name]) => name !== 'target')
      const target = typeof row.target === 'string' ? row.target : undefined
      if (target !== undefined && row.result !== null && row.result !== undefined) {
        known.set(target, row.result)
        lastResult = { name: target, value: row.result }
        blocks.push({ kind: 'calculation', solver, inputs, target, result: row.result })
      } else {
        blocks.push({ kind: 'calculation', solver, inputs })
      }
      continue
    }
    // get/event rows do not advance the narrative.
  }

  return { question, blocks }
}
