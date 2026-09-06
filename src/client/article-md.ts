/**
 * ElectroLab record → Markdown article generator.
 *
 * Renders one sealed record as a solving article: the question, then a
 * step-by-step narrative that alternates the analysis texts recorded in the
 * trace with the actual calculation rows (arguments, solver, result). Each
 * successful set/calculation is carried forward as a named condition, so the
 * article reads like a solution where previous results feed later steps.
 *
 * The article frame is intentionally in English (title and byline are fixed);
 * embedded analysis/conclusion texts stay verbatim in their original language.
 */
import { displayValue } from './ui.tsx'

/** Minimal structural view of a record body (rows carry an index signature). */
export interface ArticleSource {
  id: string
  question: string
  rows: Array<Record<string, unknown>>
}

const FRAME = {
  title: '# DeepSeek Harness ElectroLab Solution',
  byline: '*Author: DeepSeek Harness ElectroLab*',
  problem: '## Problem',
  solution: '## Solution',
  analysis: (n: number, premise?: string): string => {
    const suffix = premise === undefined ? '' : ` — given ${premise}`
    return `### Step ${n} · Analysis${suffix}`
  },
  calculation: (n: number, solver: string): string => `### Step ${n} · ${solver}`,
  given: (n: number, name: string): string => `### Step ${n} · Given: ${name}`,
  inputs: '**Inputs**',
  result: '**Result**',
  voidResult: '— completed, no target slot',
  conclusion: '## Conclusion',
  noteDrop: (name: string): string => `> The condition \`${name}\` is dropped from this point on.`,
}

/** Wrap a value for inline code, escaping backticks. */
function inline(text: string): string {
  return `\`${text.replace(/`/g, '\\`')}\``
}

/** Whether a value is a scalar typed value (shown inline) rather than structured JSON. */
function isScalarTyped(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return true
  const v = value as Record<string, unknown>
  return v.type === 'number' || v.type === 'complex' || v.type === 'string' || v.type === 'boolean' || v.type === 'slot'
}

/** Render one value for the article: inline for scalars, a JSON block for structured data. */
function valueArticle(value: unknown): string {
  if (isScalarTyped(value)) return inline(displayValue(value))
  // Structured typed value (object/array) or a plain JSON container: pretty JSON block.
  const v = value as Record<string, unknown> | null
  const raw = v !== null && typeof v === 'object' && (v.type === 'object' || v.type === 'array')
    ? v.value
    : value
  return '```json\n' + JSON.stringify(raw, null, 2) + '\n```'
}

/** Human display of an argument list: resolved values if present (slot refs already expanded). */
function argumentEntries(row: Record<string, unknown>): Array<[string, unknown]> {
  const resolved = row.resolved as Record<string, unknown> | undefined
  const args = row.args as Record<string, unknown> | undefined
  const source = resolved ?? args
  if (source === undefined) return []
  return Object.entries(source).filter(([name]) => name !== 'target')
}

/**
 * Build the article markdown from a record body. The trace is followed in
 * order; failed attempts and introspection rows are skipped.
 */
export function buildMarkdownArticle(body: ArticleSource): string {
  const sections: string[] = []
  // Named values established so far: slot name → rendered value.
  const known = new Map<string, string>()
  // The most recent result (name + rendered value), reused as the premise of the next analysis.
  let lastResult: { name: string; value: string } | undefined
  let step = 0

  const question = body.question.trim()
  const questionRows = body.rows.filter((row) => row.tool === 'marker' && row.kind === 'question')
  const questionText = question.length > 0 ? question : typeof questionRows[0]?.text === 'string' ? questionRows[0]!.text as string : body.id

  const pushAnalysis = (row: Record<string, unknown>): void => {
    const text = typeof row.text === 'string' ? row.text.trim() : ''
    if (text.length === 0) return
    step += 1
    const premise = lastResult === undefined ? undefined : `${inline(lastResult.name)} = ${lastResult.value}`
    sections.push(`${FRAME.analysis(step, premise)}\n\n${text}`)
    // The premise has been used; it no longer needs a dedicated lead-in.
    lastResult = undefined
  }

  for (const row of body.rows) {
    if (row.ok !== true) continue
    const tool = row.tool
    if (tool === 'solver_info') continue
    if (tool === 'marker') {
      const kind = row.kind
      if (kind === 'answer') {
        const text = typeof row.text === 'string' ? row.text.trim() : ''
        if (text.length > 0) sections.push(`${FRAME.conclusion}\n\n${text}`)
      } else if (kind === 'analyse') {
        pushAnalysis(row)
      }
      // question markers are rendered from the problem header; duplicate markers stay silent.
      continue
    }
    if (tool === 'set') {
      const name = typeof row.name === 'string' ? row.name : ''
      if (row.deleted === true) {
        known.delete(name)
        sections.push(FRAME.noteDrop(name))
        continue
      }
      step += 1
      const rendered = valueArticle(row.value)
      known.set(name, rendered)
      lastResult = { name, value: rendered }
      sections.push(`${FRAME.given(step, name)}\n\n${inline(name)} = ${rendered}`)
      continue
    }
    if (tool === 'call') {
      const solver = typeof row.solver === 'string' ? row.solver : 'call'
      step += 1
      const lines: string[] = [FRAME.calculation(step, inline(solver))]
      const args = argumentEntries(row)
      if (args.length > 0) {
        lines.push(FRAME.inputs)
        lines.push(...args.map(([name, value]) => `- ${inline(name)}: ${valueArticle(value)}`))
      }
      const target = typeof row.target === 'string' ? row.target : undefined
      if (target !== undefined && row.result !== null && row.result !== undefined) {
        const rendered = valueArticle(row.result)
        known.set(target, rendered)
        lastResult = { name: target, value: rendered }
        lines.push(`${FRAME.result}: ${inline(target)} = ${rendered}`)
      } else {
        lines.push(`${FRAME.result}: ${FRAME.voidResult}`)
      }
      sections.push(lines.join('\n'))
      continue
    }
    // get/event rows do not advance the narrative.
  }

  const header = [
    FRAME.title,
    '',
    FRAME.byline,
    '',
    FRAME.problem,
    '',
    `> ${questionText}`,
    '',
    FRAME.solution,
  ]
  return [...header, ...sections].join('\n\n') + '\n'
}
