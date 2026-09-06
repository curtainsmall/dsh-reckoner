/**
 * ElectroLab record → Markdown article renderer.
 *
 * Renders one sealed record as a solving article: the question, then a
 * step-by-step narrative that alternates the analysis texts recorded in the
 * trace with the actual calculation rows (arguments, solver, result). Each
 * successful set/calculation is carried forward as a named condition, so the
 * article reads like a solution where previous results feed later steps.
 *
 * The narrative walk lives in article-core.ts; this file only renders blocks.
 * The article frame is intentionally in English (title and byline are fixed);
 * embedded analysis/conclusion texts stay verbatim in their original language.
 */
import { narrativeOf, isScalarValue, innerOf, humanOf, type ArticleSource, type NarrativeBlock, type NamedValue } from './article-core.ts'

export type { ArticleSource } from './article-core.ts'

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

/** Render one value for the article: inline for scalars, a JSON block for structured data. */
function valueArticle(value: unknown): string {
  if (isScalarValue(value)) return inline(humanOf(value))
  return '```json\n' + JSON.stringify(innerOf(value), null, 2) + '\n```'
}

/** Premise text for an analysis heading; structured values contribute only their name. */
function premiseArticle(premise: NamedValue): string | undefined {
  if (!isScalarValue(premise.value)) return inline(premise.name)
  return `${inline(premise.name)} = ${inline(humanOf(premise.value))}`
}

/** Build the article markdown from a record body. */
export function buildMarkdownArticle(body: ArticleSource): string {
  const { question, blocks } = narrativeOf(body)
  const sections: string[] = []
  let step = 0

  const pushBlock = (block: NarrativeBlock): void => {
    if (block.kind === 'analysis') {
      step += 1
      sections.push(`${FRAME.analysis(step, block.premise === undefined ? undefined : premiseArticle(block.premise))}\n\n${block.text}`)
    } else if (block.kind === 'given') {
      step += 1
      sections.push(`${FRAME.given(step, block.name)}\n\n${inline(block.name)} = ${valueArticle(block.value)}`)
    } else if (block.kind === 'drop') {
      sections.push(FRAME.noteDrop(block.name))
    } else if (block.kind === 'calculation') {
      step += 1
      const lines: string[] = [FRAME.calculation(step, inline(block.solver))]
      if (block.inputs.length > 0) {
        lines.push(FRAME.inputs)
        lines.push(...block.inputs.map(([name, value]) => `- ${inline(name)}: ${valueArticle(value)}`))
      }
      if (block.target !== undefined && block.result !== undefined) {
        const rendered = valueArticle(block.result)
        lines.push(`${FRAME.result}: ${inline(block.target)} = ${rendered}`)
      } else {
        lines.push(`${FRAME.result}: ${FRAME.voidResult}`)
      }
      sections.push(lines.join('\n'))
    } else {
      sections.push(`${FRAME.conclusion}\n\n${block.text}`)
    }
  }
  for (const block of blocks) pushBlock(block)

  const header = [
    FRAME.title,
    '',
    FRAME.byline,
    '',
    FRAME.problem,
    '',
    `> ${question}`,
    '',
    FRAME.solution,
  ]
  return [...header, ...sections].join('\n\n') + '\n'
}
