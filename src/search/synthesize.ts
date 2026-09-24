/**
 * Run the extractive call and read its reply.
 *
 * A reply that cannot be read as the agreed JSON object is a technical failure,
 * not an answer: the raw text is kept for the record and never reaches the
 * model, because an unreadable reply is exactly the case where a plausible
 * sentence could smuggle in an unchecked number.
 */
import type { LlmLike, LlmRoute } from '../llm-call.ts'
import { streamLlmText } from '../llm-call.ts'
import { buildSearchPrompt, SEARCH_SYSTEM_PROMPT, type SearchMaterial } from './prompt.ts'

/** The reply shape the prompt asks for. */
export interface SynthesisReply {
  readonly answer: string
  /** Indices into the material list the synthesis relied on. */
  readonly used: readonly number[]
  readonly insufficient: boolean
}

/**
 * Read the agreed JSON object out of a model reply.
 * @param text - the model's own text.
 * @param materialCount - how many material items were sent, for clamping `used`.
 * @returns the reply, or null when the text is not the agreed envelope.
 */
export function parseSynthesisReply(text: string, materialCount: number): SynthesisReply | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as unknown
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const bag = parsed as Record<string, unknown>
  const answer = bag['answer']
  if (typeof answer !== 'string' || answer.trim().length === 0) return null
  const insufficient = bag['insufficient'] === true
  const used: number[] = []
  const rawUsed = bag['used']
  if (Array.isArray(rawUsed)) {
    for (const entry of rawUsed) {
      if (typeof entry !== 'number' || !Number.isInteger(entry)) continue
      const index = entry - 1
      if (index >= 0 && index < materialCount && !used.includes(index)) used.push(index)
    }
  }
  return { answer: answer.trim(), used: insufficient ? [] : used, insufficient }
}

/** What one extractive call needs. */
export interface SynthesisRequest {
  readonly llm: LlmLike
  readonly route: LlmRoute
  readonly question: string
  readonly materials: readonly SearchMaterial[]
  readonly maxTokens: number
  readonly signal?: AbortSignal
}

/** Either the reply, or the one sentence that says why there is none. */
export type SynthesisOutcome =
  | { readonly ok: true; readonly reply: SynthesisReply }
  | { readonly ok: false; readonly error: string }

/** Ask for one answer and read it. Never throws: the caller records the failure and answers the model with it. */
export async function synthesize(request: SynthesisRequest): Promise<SynthesisOutcome> {
  let text: string
  try {
    text = await streamLlmText({
      llm: request.llm,
      route: request.route,
      system: SEARCH_SYSTEM_PROMPT,
      user: buildSearchPrompt(request.question, request.materials),
      maxTokens: request.maxTokens,
      what: 'search answer',
      activity: 'the search lookup',
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  const reply = parseSynthesisReply(text, request.materials.length)
  if (reply === null) {
    return { ok: false, error: 'the extractive step returned no readable answer object' }
  }
  return { ok: true, reply }
}
