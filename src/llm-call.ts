/**
 * The one place that reads the host LLM stream.
 *
 * Article generation and the search synthesis both make a single, tool-free
 * model call and read a text answer off the stream; the chunk kinds, the finish
 * reasons and the failure sentences live here so the two cannot drift.
 *
 * Both callers declare `timeoutMs` on their tool/path only when they forward the
 * abort signal, which is why the signal travels through this module.
 */
import { log } from './log.ts'

/** The stream chunk types this module reads; every other type falls through untouched. */
export enum StreamChunkKind {
  TextDelta = 'text-delta',
  ToolCallDelta = 'tool-call-delta',
  Finish = 'finish',
}

/**
 * The finish reasons the shell reports. The wire union is merge-extensible, so an
 * unknown kind still falls through - this enum names only the kinds we act on.
 */
export enum FinishReasonKind {
  Stop = 'stop',
  ToolCalls = 'tool-calls',
  MaxTokens = 'max-tokens',
  Aborted = 'aborted',
  Error = 'error',
}

/** Whether a string read off the stream is a chunk kind this module acts on. */
export function toStreamChunkKind(value: unknown): StreamChunkKind | undefined {
  return typeof value === 'string' && (Object.values(StreamChunkKind) as readonly string[]).includes(value)
    ? (value as StreamChunkKind)
    : undefined
}

/** Whether a string read off the stream is a finish reason this module acts on. */
export function toFinishReasonKind(value: unknown): FinishReasonKind | undefined {
  return typeof value === 'string' && (Object.values(FinishReasonKind) as readonly string[]).includes(value)
    ? (value as FinishReasonKind)
    : undefined
}

/** The host LLM runtime shape both callers need (dsh-llm). */
export interface LlmLike {
  stream(options: {
    provider: string
    model: string
    messages: Array<{ role: string; content: Array<{ type: string; text: string }> }>
    system?: string
    maxTokens?: number
    signal?: AbortSignal
  }): AsyncIterable<unknown>
}

/** The deployment default-model selection (dsh-agent-default-model). */
export interface AgentDefaultModelLike {
  currentSelection(): { provider: string; model: string; reasoningEffort?: string }
}

/** The model route one call runs on. */
export interface LlmRoute {
  readonly provider: string
  readonly model: string
}

/** One tool-free model call, and the words its failures use. */
export interface LlmTextCall {
  readonly llm: LlmLike
  readonly route: LlmRoute
  readonly system: string
  readonly user: string
  readonly maxTokens: number
  /** What the call produces, for the failure sentences: "article text", "search answer". */
  readonly what: string
  /** What the call is, for the abort sentence: "article generation", "the search lookup". */
  readonly activity: string
  readonly signal?: AbortSignal
  /** Called after every chunk with how much text has arrived (progress reporting). */
  readonly onTick?: (chars: number) => void
}

/**
 * Run one tool-free model call and return its trimmed text.
 *
 * A tool request is an error: neither caller has a tool surface, so a tool call
 * would mean the model answered something else than it was asked.
 */
export async function streamLlmText(call: LlmTextCall): Promise<string> {
  const { llm, route, system, user, maxTokens, what, activity, signal, onTick } = call
  let text = ''
  /** The provider's own finish reason, kept so an empty result can name it instead of guessing. */
  let seenFinish: FinishReasonKind | undefined
  for await (const raw of llm.stream({
    provider: route.provider,
    model: route.model,
    messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    system,
    maxTokens,
    ...(signal === undefined ? {} : { signal }),
  })) {
    const chunk = raw as {
      type?: string
      text?: string
      reason?: string | { kind?: string; failure?: { message?: string } }
    }
    const chunkKind = toStreamChunkKind(chunk.type)
    if (chunkKind === StreamChunkKind.TextDelta) {
      text += chunk.text ?? ''
    } else if (chunkKind === StreamChunkKind.ToolCallDelta) {
      throw new Error(`the model unexpectedly requested a tool while writing ${what}`)
    } else if (chunkKind === StreamChunkKind.Finish) {
      // The finish chunk carries the provider's reason as an object (`{kind, failure}`);
      // a bare string is tolerated too. Without this the reason is silently lost and any
      // failed call surfaces as "no text", which is what the first attempt of a cold
      // provider looks like.
      const reason = chunk.reason
      const kind = toFinishReasonKind(typeof reason === 'string' ? reason : reason?.kind)
      const detail = typeof reason === 'string' ? '' : (reason?.failure?.message ?? '')
      seenFinish = kind ?? seenFinish
      if (kind === FinishReasonKind.Aborted) throw new Error(`${activity} was aborted`)
      if (kind === FinishReasonKind.Error) {
        if (text.trim().length === 0) {
          throw new Error(
            `the model call failed: ${detail.length > 0 ? detail : 'the provider reported an error without a message'}`,
          )
        }
        log.warn('model call finished with an error after some text', { what, detail })
      }
      if (kind === FinishReasonKind.MaxTokens) {
        if (text.trim().length === 0) throw new Error(`the model hit its token limit before producing any ${what}`)
        log.warn('model call was cut off by the token limit', { what, chars: text.length })
      }
    }
    if (onTick !== undefined) onTick(text.length)
  }
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    throw new Error(`the model produced no ${what} (finish: ${seenFinish ?? 'none'})`)
  }
  return trimmed
}
