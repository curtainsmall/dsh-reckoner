/**
 * The shared model-call reader. This is where the finish-reason bug lived (a
 * reason object compared against a bare string, so an aborted or failed call
 * surfaced as "no text"), so every chunk kind and finish reason is pinned here.
 */
import { describe, expect, it } from 'vitest'
import { FinishReasonKind, StreamChunkKind, streamLlmText, toFinishReasonKind, toStreamChunkKind } from '../src/llm-call.ts'

/** A model stream that yields the given chunks. */
function streamOf(chunks: unknown[]) {
  return {
    stream: () => (async function* () { for (const chunk of chunks) yield chunk })(),
  }
}

const ROUTE = { provider: 'deepseek', model: 'deepseek-v4-flash' }

function call(chunks: unknown[], overrides: { signal?: AbortSignal } = {}): Promise<string> {
  return streamLlmText({
    llm: streamOf(chunks) as never,
    route: ROUTE,
    system: 's',
    user: 'u',
    maxTokens: 16,
    what: 'search answer',
    activity: 'the search lookup',
    ...overrides,
  })
}

describe('the shared model call', () => {
  it('joins the text deltas and trims the result', async () => {
    expect(await call([
      { type: 'text-delta', text: '  Copper ' },
      { type: 'text-delta', text: 'conducts 401. ' },
      { type: 'finish', reason: { kind: FinishReasonKind.Stop } },
    ])).toBe('Copper conducts 401.')
  })

  it('ignores a chunk kind it does not act on', async () => {
    expect(await call([
      { type: 'thinking-delta', text: 'not the answer' },
      { type: 'text-delta', text: 'answer' },
    ])).toBe('answer')
  })

  it('refuses a tool request, because neither caller has a tool surface', async () => {
    await expect(call([{ type: 'tool-call-delta', text: '{}' }])).rejects.toThrow('unexpectedly requested a tool')
  })

  it('names the abort and the activity', async () => {
    await expect(call([{ type: 'finish', reason: { kind: FinishReasonKind.Aborted } }]))
      .rejects.toThrow('the search lookup was aborted')
  })

  it('carries the provider detail of a failure that produced no text', async () => {
    await expect(call([{ type: 'finish', reason: { kind: FinishReasonKind.Error, failure: { message: 'quota exhausted' } } }]))
      .rejects.toThrow('the model call failed: quota exhausted')
  })

  it('keeps the text of a failure that arrived after some text', async () => {
    expect(await call([
      { type: 'text-delta', text: 'partial' },
      { type: 'finish', reason: { kind: FinishReasonKind.Error, failure: { message: 'dropped' } } },
    ])).toBe('partial')
  })

  it('names the token limit and the empty result, with the finish reason', async () => {
    await expect(call([{ type: 'finish', reason: { kind: FinishReasonKind.MaxTokens } }]))
      .rejects.toThrow('the model hit its token limit before producing any search answer')
    await expect(call([{ type: 'finish', reason: { kind: FinishReasonKind.Stop } }]))
      .rejects.toThrow('the model produced no search answer (finish: stop)')
    await expect(call([])).rejects.toThrow('the model produced no search answer (finish: none)')
  })

  it('reads a bare string finish reason too, and reports how much arrived', async () => {
    const seen: number[] = []
    await streamLlmText({
      llm: streamOf([
        { type: 'text-delta', text: 'abc' },
        { type: 'text-delta', text: 'de' },
        { type: 'finish', reason: 'stop' },
      ]) as never,
      route: ROUTE,
      system: 's',
      user: 'u',
      maxTokens: 16,
      what: 'article text',
      activity: 'article generation',
      onTick: (chars) => { seen.push(chars) },
    })
    expect(seen).toEqual([3, 5, 5])
  })

  it('recognizes only the kinds and reasons it acts on', () => {
    expect(toStreamChunkKind('finish')).toBe(StreamChunkKind.Finish)
    expect(toStreamChunkKind('something-new')).toBeUndefined()
    expect(toStreamChunkKind(7)).toBeUndefined()
    for (const kind of Object.values(FinishReasonKind)) expect(toFinishReasonKind(kind)).toBe(kind)
    expect(toFinishReasonKind('something-new')).toBeUndefined()
    expect(toFinishReasonKind(undefined)).toBeUndefined()
  })
})
