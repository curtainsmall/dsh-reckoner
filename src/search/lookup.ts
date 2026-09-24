/**
 * One lookup: retrieve, apply the policy, read the allowed material, answer.
 *
 * The pipeline is deliberately narrow. The provider decides what to search - we
 * send the question verbatim and never plan queries ourselves - the policy
 * decides what the extractive step may read, and the engine records the fact.
 * The model receives the answer alone.
 *
 * Every path writes exactly one row into the open record, including the three
 * that answer nothing: a record is the account of what happened, and a lookup
 * that was refused or failed is part of it.
 */
import type { Engine, Receipt } from '../engine/engine.ts'
import {
  SearchErrorCode,
  SearchOutcome,
  SearchTier,
  type SearchFact,
  type SearchSource,
} from '../engine/search.ts'
import type { AgentDefaultModelLike, LlmLike, LlmRoute } from '../llm-call.ts'
import type { SearchConfig } from './config.ts'
import { policySnapshot } from './config.ts'
import { allowedSources, originOf } from './policy.ts'
import { SEARCH_PROMPT_VERSION, type SearchMaterial } from './prompt.ts'
import { synthesize } from './synthesize.ts'

/** The `web` seam as this module uses it (dsh-web). */
export interface WebLike {
  search(
    request: { query: string; maxResults?: number },
    signal?: AbortSignal,
  ): Promise<{ content?: string; sources: readonly SearchSource[]; truncated: boolean }>
  fetch(
    request: { url: string },
    signal?: AbortSignal,
  ): Promise<{ url: string; statusCode: number; body: { kind: string; content: string }; truncated: boolean }>
}

/** What one lookup needs from the host: the engine that records it and the services it calls. */
export interface SearchHost {
  readonly engine: Engine
  get(name: string): unknown
  warn(message: string, fields?: Record<string, unknown>): void
}

/** One lookup request. */
export interface LookupRequest {
  readonly question: string
  readonly signal?: AbortSignal
}

/**
 * What the model receives: the answer and the class of source it came from, or
 * the receipt-shaped failure every other tool answers with.
 */
export interface LookupReceipt {
  readonly ok: boolean
  readonly answer?: string
  readonly origin?: string
  readonly code?: string
  readonly error?: string
}

function readService<T>(host: SearchHost, name: string): T | undefined {
  try {
    return host.get(name) as T | undefined
  } catch {
    return undefined
  }
}

/** One sentence the model can act on, in the voice of the engine's own failures. */
function refusal(question: string, budget: number): string {
  return (
    `this record has used all ${budget} of its lookups, so "${question}" was not searched. ` +
    'State which quantity is still missing instead of looking it up again, or close the record and ask again.'
  )
}

function insufficientError(question: string, answer: string | undefined): string {
  const opening = `no source the policy allows answered "${question}".`
  return answer === undefined || answer.trim().length === 0
    ? `${opening} State which quantity is missing instead of estimating it.`
    : `${opening} ${answer.trim()}`
}

/** The route the extractive step runs on: the configured pin, or the deployment default model. */
function resolveRoute(
  host: SearchHost,
  config: SearchConfig,
): { route: LlmRoute; llm: LlmLike } | { error: string } {
  const llm = readService<LlmLike>(host, 'llm')
  if (llm === undefined) return { error: 'the LLM service is unavailable in this deployment' }
  const defaults = readService<AgentDefaultModelLike>(host, 'agentDefaultModel')
  const selected = defaults?.currentSelection()
  const provider = config.synthesis.provider ?? selected?.provider
  const model = config.synthesis.model ?? selected?.model
  if (provider === undefined || model === undefined) {
    return { error: 'no default model is configured — pick one in Settings first' }
  }
  return { route: { provider, model }, llm }
}

/** The material the extractive step reads: the provider's fields, plus the fetched text when enrich ran. */
function toMaterials(sources: readonly SearchSource[], texts: ReadonlyMap<string, string>): SearchMaterial[] {
  return sources.map((source) => {
    const text = texts.get(source.url)
    return text === undefined ? { ...source } : { ...source, text }
  })
}

/** Fetch the allowed pages for their text; a page that will not load is simply not enriched. */
async function enrich(
  host: SearchHost,
  web: WebLike,
  config: SearchConfig,
  sources: readonly SearchSource[],
  signal: AbortSignal | undefined,
): Promise<Map<string, string>> {
  const texts = new Map<string, string>()
  for (const source of sources.slice(0, config.enrich.pages)) {
    try {
      const fetched = await web.fetch({ url: source.url }, signal)
      if (fetched.statusCode >= 200 && fetched.statusCode < 300 && fetched.body.content.length > 0) {
        texts.set(source.url, fetched.body.content.slice(0, config.enrich.charsPerPage))
      }
    } catch (error) {
      host.warn('search enrich failed', { url: source.url, error })
    }
  }
  return texts
}

/**
 * Run one lookup and record it.
 * @param host - the engine that records the fact and the services the call uses.
 * @param config - the resolved policy of the calling row.
 * @param request - the question as the model asked it, verbatim.
 * @returns the model-facing receipt: the answer, or a code and one sentence.
 */
export async function lookup(host: SearchHost, config: SearchConfig, request: LookupRequest): Promise<LookupReceipt> {
  const startedAt = Date.now()
  const question = request.question
  const strict = config.tier === SearchTier.Strict
  // The policy travels into every row: a policy that can be re-tuned while the host runs must still
  // leave behind what this particular call was allowed to do.
  const policy = policySnapshot(config)

  const record = (fact: Omit<SearchFact, 'question' | 'tier' | 'durationMs' | 'policy'>): void => {
    const full: SearchFact = { question, tier: config.tier, durationMs: Date.now() - startedAt, policy, ...fact }
    const receipt: Receipt = host.engine.recordSearch(full)
    if (receipt['ok'] !== true) host.warn('search fact was not recorded', { receipt })
  }

  if (host.engine.openRecordId() === null) {
    return {
      ok: false,
      code: SearchErrorCode.NoRecord,
      error: 'no record is open: call record_start first. A search is recorded, so it needs the record it belongs to.',
    }
  }

  if (host.engine.countSearchRows() >= config.maxSearchesPerRecord) {
    const error = refusal(question, config.maxSearchesPerRecord)
    record({ outcome: SearchOutcome.Refused, candidates: [], used: [], error })
    return { ok: false, code: SearchErrorCode.BudgetExceeded, error }
  }

  const web = readService<WebLike>(host, 'web')
  if (web === undefined) {
    const error = 'the web service is unavailable in this deployment, so nothing can be looked up'
    record({ outcome: SearchOutcome.Failed, candidates: [], used: [], error })
    return { ok: false, code: SearchErrorCode.Unavailable, error }
  }

  // Resolve the extractive route before the retrieval: a deployment without a
  // model cannot answer, and paying for a search it will discard helps nobody.
  const route = resolveRoute(host, config)
  if ('error' in route) {
    record({ outcome: SearchOutcome.Failed, candidates: [], used: [], error: route.error })
    return { ok: false, code: SearchErrorCode.Unavailable, error: route.error }
  }

  let candidates: SearchSource[]
  try {
    const found = await web.search(
      { query: question, maxResults: config.maxResults },
      request.signal,
    )
    candidates = [...found.sources]
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const error_ = `the lookup could not run: ${message}`
    record({ outcome: SearchOutcome.Failed, candidates: [], used: [], error: error_ })
    return { ok: false, code: SearchErrorCode.Unavailable, error: error_ }
  }

  const allowed = allowedSources(candidates, config.allowedHosts, strict)
  const texts =
    config.enrich.pages > 0 && allowed.length > 0
      ? await enrich(host, web, config, allowed, request.signal)
      : new Map<string, string>()
  const materials = toMaterials(allowed, texts)

  if (materials.length === 0) {
    const error = insufficientError(question, undefined)
    record({ outcome: SearchOutcome.Insufficient, candidates, used: [], error })
    return { ok: false, code: SearchErrorCode.Insufficient, error }
  }

  const synthesis = await synthesize({
    llm: route.llm,
    route: route.route,
    question,
    materials,
    maxTokens: config.synthesis.maxTokens,
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })

  if (!synthesis.ok) {
    record({ outcome: SearchOutcome.Failed, candidates, used: allowed, error: synthesis.error })
    return { ok: false, code: SearchErrorCode.Unavailable, error: `the lookup could not run: ${synthesis.error}` }
  }

  const { answer, used, insufficient } = synthesis.reply
  const answered = {
    provider: route.route.provider,
    model: route.route.model,
    promptVersion: SEARCH_PROMPT_VERSION,
    answer,
    used,
  }

  if (insufficient) {
    const error = insufficientError(question, answer)
    record({ outcome: SearchOutcome.Insufficient, candidates, used: allowed, synthesis: answered, error })
    return { ok: false, code: SearchErrorCode.Insufficient, error }
  }

  const trimmed = answer.length > config.answerMaxChars ? `${answer.slice(0, config.answerMaxChars).trimEnd()}…` : answer
  record({
    outcome: SearchOutcome.Answered,
    candidates,
    used: allowed,
    synthesis: { ...answered, answer: trimmed },
  })
  return { ok: true, answer: trimmed, origin: originOf(allowed, config.tier) }
}
