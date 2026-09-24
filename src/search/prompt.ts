/**
 * The extractive step: turn retrieved material into one answer, or into a
 * refusal.
 *
 * The prompt is the whole guarantee. It runs as a bare model call with no tools
 * and no memory of the session, and it is told to answer from the material
 * alone: a synthesis that fills a gap from its own knowledge would put an
 * unverifiable number behind a documented-looking source, which is exactly the
 * failure the search tool exists to prevent. It never converts a unit or
 * computes a derived value either - the engine does that, on a value the model
 * then stores itself.
 *
 * The version travels into the record with every answer, so a wrong answer can
 * be traced to the prompt that produced it.
 */
import type { SearchSource } from '../engine/search.ts'

/** The prompt version recorded with every synthesis. */
export const SEARCH_PROMPT_VERSION = 'search-extract/1'

/** One piece of material as the synthesis sees it: the provider's own fields, plus fetched text when any. */
export interface SearchMaterial {
  readonly url: string
  readonly title?: string
  readonly snippet?: string
  readonly publishedAt?: string
  /** The fetched page text, when the enrich step ran for this source. */
  readonly text?: string
}

/** The system prompt of the extractive step. */
export const SEARCH_SYSTEM_PROMPT = [
  'You extract one factual answer from retrieved web material for a calculation assistant.',
  '',
  'Rules, in order of importance:',
  '1. Use ONLY the material below. Never add anything from your own knowledge, and never guess.',
  '2. If the material does not contain the answer, answer with insufficient true and say in one sentence what is missing.',
  '3. Copy every number with the unit exactly as the material writes it. Never convert a unit, never round, and never compute a derived value - the caller does that with a checked calculator.',
  '4. When the material disagrees with itself, say so in the answer and keep both values with their sources; still answer when one value is clearly the one the question asks for.',
  '5. Answer in the language of the question, in at most 120 words, with no preamble and no markdown heading.',
  '',
  'Reply with one JSON object and nothing else:',
  '{"answer": string, "used": number[], "insufficient": boolean}',
  '`used` lists the 1-based numbers of the material items you relied on; it is empty when insufficient is true.',
].join('\n')

/** The user message: the question, then the numbered material. */
export function buildSearchPrompt(question: string, materials: readonly SearchMaterial[]): string {
  const lines: string[] = [`Question: ${question}`, '', 'Material:']
  materials.forEach((material, index) => {
    const header: string[] = [`[${index + 1}] ${material.title ?? material.url}`, `url: ${material.url}`]
    if (material.publishedAt !== undefined) header.push(`published: ${material.publishedAt}`)
    lines.push(header.join('\n'))
    const body = material.text ?? material.snippet
    if (body !== undefined && body.trim().length > 0) lines.push(body.trim())
    lines.push('')
  })
  return lines.join('\n')
}
