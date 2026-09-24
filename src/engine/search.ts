/**
 * The search fact: what one `search` call asked, what the provider returned,
 * which sources the policy allowed, and what the extractive synthesis answered.
 *
 * The fact is the record's account of an outside lookup, so it keeps everything
 * the model never sees - the candidate sources with their snippets, the
 * synthesizing route and prompt version, and why a call produced no answer. The
 * model-facing receipt is only the answer.
 *
 * Like every other trace content this is plain JSON: the panel and the article
 * facts read it back with {@link readSearchFact}.
 */
import { EngineErrorCode, fail } from '../errors.ts'
import { describe } from './describe.ts'

/** Which sources a call was allowed to read. */
export enum SearchTier {
  /** Only hosts on the allow-list; a call whose hits are all outside it answers nothing. */
  Strict = 'strict',
  /** Every host the provider returned; the record marks the answer as web-derived. */
  Open = 'open',
}

/** How one call ended. Every search writes a row, including the three that answer nothing. */
export enum SearchOutcome {
  Answered = 'answered',
  /** The material did not hold the answer, so no answer was given. */
  Insufficient = 'insufficient',
  /** The per-record budget was spent; the call never reached the provider. */
  Refused = 'refused',
  /** The provider, the network or the synthesis failed. */
  Failed = 'failed',
}

/** The class of source an answer came from, for the model's own calibration. */
export enum SearchOrigin {
  Github = 'github',
  Allowlist = 'allowlist',
  Web = 'web',
}

/** The failure codes one `search` call can answer with. */
export enum SearchErrorCode {
  /** The provider, the network or the synthesis could not run. */
  Unavailable = 'SEARCH_UNAVAILABLE',
  /** The allowed sources did not hold the answer. */
  Insufficient = 'SEARCH_INSUFFICIENT',
  /** The record has spent its search budget. */
  BudgetExceeded = 'SEARCH_BUDGET_EXCEEDED',
  /** A slot-table state: no record is open, so nothing can be recorded. */
  NoRecord = 'ENGINE_OPEN_RECORD_NOT_FOUND',
}

/** One source, in the provider's own shape: a URL always, the rest when the provider supplies it. */
export interface SearchSource {
  readonly url: string
  readonly title?: string
  readonly snippet?: string
  readonly publishedAt?: string
}

/** How the answer was produced: the route, the prompt version, and which sources it relied on. */
export interface SearchSynthesis {
  readonly provider: string
  readonly model: string
  readonly promptVersion: string
  /** The extractive answer, exactly as the synthesis returned it. */
  readonly answer: string
  /** Indices into {@link SearchFact.used} that the synthesis said it relied on. */
  readonly used: readonly number[]
}

/** The effective lookup policy of one call: the fields a reader needs to re-derive its behaviour. */
export interface SearchPolicyRecord {
  readonly tier: string
  readonly allowedHosts: readonly string[]
  readonly maxResults: number
  readonly maxSearchesPerRecord: number
  readonly answerMaxChars: number
  readonly enrichPages: number
  readonly enrichCharsPerPage: number
}

/** One search call, as the record stores it. */
export interface SearchFact {
  /** What the model asked, verbatim. */
  readonly question: string
  readonly tier: SearchTier
  readonly outcome: SearchOutcome
  /** Everything the provider returned, in its order. */
  readonly candidates: readonly SearchSource[]
  /** The sources the tier policy allowed the synthesis to read. */
  readonly used: readonly SearchSource[]
  /** The policy in force for this call, so a reader can see what it was allowed to do. */
  readonly policy?: SearchPolicyRecord
  /** Absent when the call ended before any synthesis ran. */
  readonly synthesis?: SearchSynthesis
  /** One self-sufficient sentence when the call answered nothing. */
  readonly error?: string
  readonly durationMs: number
}

function searchSource(input: unknown, where: string): SearchSource {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    fail(EngineErrorCode.InvalidArgs, `${where} must be an object with a url; got ${describe(input)}.`)
  }
  const bag = input as Record<string, unknown>
  const url = bag['url']
  if (typeof url !== 'string' || url.trim().length === 0) {
    fail(EngineErrorCode.InvalidArgs, `${where} needs a non-empty url string; got ${describe(url)}.`)
  }
  const source: { url: string; title?: string; snippet?: string; publishedAt?: string } = { url }
  for (const field of ['title', 'snippet', 'publishedAt'] as const) {
    const value = bag[field]
    if (typeof value === 'string' && value.length > 0) source[field] = value
  }
  return source
}

function searchSources(input: unknown, where: string): SearchSource[] {
  if (!Array.isArray(input)) {
    fail(EngineErrorCode.InvalidArgs, `${where} must be an array of sources; got ${describe(input)}.`)
  }
  return input.map((entry, index) => searchSource(entry, `${where}[${index}]`))
}

/**
 * Validate one search fact. The strict reader behind both `recordSearch` and
 * {@link readSearchFact}; every rejection is an `ENGINE_INVALID_ARGS` failure.
 */
export function parseSearchFact(input: unknown): SearchFact {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    fail(EngineErrorCode.InvalidArgs, `a search fact must be an object; got ${describe(input)}.`)
  }
  const bag = input as Record<string, unknown>
  const question = bag['question']
  if (typeof question !== 'string' || question.trim().length === 0) {
    fail(EngineErrorCode.InvalidArgs, `a search fact needs a non-empty question string; got ${describe(question)}.`)
  }
  const tier = bag['tier']
  if (!(Object.values(SearchTier) as readonly unknown[]).includes(tier)) {
    fail(EngineErrorCode.InvalidArgs, `a search fact needs tier "strict" or "open"; got ${describe(tier)}.`)
  }
  const outcome = bag['outcome']
  if (!(Object.values(SearchOutcome) as readonly unknown[]).includes(outcome)) {
    fail(
      EngineErrorCode.InvalidArgs,
      `a search fact needs outcome answered, insufficient, refused or failed; got ${describe(outcome)}.`,
    )
  }
  const durationMs = bag['durationMs']
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
    fail(EngineErrorCode.InvalidArgs, `a search fact needs a duration in milliseconds; got ${describe(durationMs)}.`)
  }
  const fact: {
    question: string
    tier: SearchTier
    outcome: SearchOutcome
    candidates: SearchSource[]
    used: SearchSource[]
    policy?: SearchPolicyRecord
    synthesis?: SearchSynthesis
    error?: string
    durationMs: number
  } = {
    question,
    tier: tier as SearchTier,
    outcome: outcome as SearchOutcome,
    candidates: searchSources(bag['candidates'] ?? [], 'the search candidates'),
    used: searchSources(bag['used'] ?? [], 'the allowed search sources'),
    durationMs,
  }
  const error = bag['error']
  if (typeof error === 'string' && error.length > 0) fact.error = error
  const policy = bag['policy']
  if (policy !== undefined && policy !== null) fact.policy = parsePolicy(policy)
  const synthesis = bag['synthesis']
  if (synthesis !== undefined && synthesis !== null) {
    fact.synthesis = parseSynthesis(synthesis)
  }
  if (fact.outcome === SearchOutcome.Answered && fact.synthesis === undefined) {
    fail(EngineErrorCode.InvalidArgs, 'an answered search fact needs the synthesis that produced the answer.')
  }
  return fact
}

/** Validate the policy snapshot one row carries; every field it names must be usable as recorded. */
function parsePolicy(input: unknown): SearchPolicyRecord {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    fail(EngineErrorCode.InvalidArgs, `the search policy must be an object; got ${describe(input)}.`)
  }
  const bag = input as Record<string, unknown>
  const tier = bag['tier']
  if (typeof tier !== 'string' || tier.length === 0) {
    fail(EngineErrorCode.InvalidArgs, `the search policy needs a non-empty tier; got ${describe(tier)}.`)
  }
  const hosts = bag['allowedHosts']
  const allowedHosts = Array.isArray(hosts) ? hosts.filter((entry): entry is string => typeof entry === 'string') : []
  const numbers: Record<'maxResults' | 'maxSearchesPerRecord' | 'answerMaxChars' | 'enrichPages' | 'enrichCharsPerPage', number> = {
    maxResults: 0,
    maxSearchesPerRecord: 0,
    answerMaxChars: 0,
    enrichPages: 0,
    enrichCharsPerPage: 0,
  }
  for (const field of ['maxResults', 'maxSearchesPerRecord', 'answerMaxChars', 'enrichPages', 'enrichCharsPerPage'] as const) {
    const value = bag[field]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      fail(EngineErrorCode.InvalidArgs, `the search policy needs a non-negative ${field} number; got ${describe(value)}.`)
    }
    numbers[field] = value
  }
  return { tier, allowedHosts, ...numbers }
}

function parseSynthesis(input: unknown): SearchSynthesis {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    fail(EngineErrorCode.InvalidArgs, `the search synthesis must be an object; got ${describe(input)}.`)
  }
  const bag = input as Record<string, unknown>
  const fields: Record<'provider' | 'model' | 'promptVersion' | 'answer', string> = {
    provider: '',
    model: '',
    promptVersion: '',
    answer: '',
  }
  for (const field of ['provider', 'model', 'promptVersion', 'answer'] as const) {
    const value = bag[field]
    if (typeof value !== 'string' || value.length === 0) {
      fail(EngineErrorCode.InvalidArgs, `the search synthesis needs a non-empty ${field} string; got ${describe(value)}.`)
    }
    fields[field] = value
  }
  const used = bag['used']
  const indices = Array.isArray(used)
    ? used.filter((entry): entry is number => typeof entry === 'number' && Number.isInteger(entry) && entry >= 0)
    : []
  return { ...fields, used: indices }
}

/** The tolerant reader for rows already on disk: a malformed fact reads as absent, never as a throw. */
export function readSearchFact(input: unknown): SearchFact | null {
  try {
    return parseSearchFact(input)
  } catch {
    return null
  }
}

/** The stored JSON shape of one fact: the fields the record keeps, in a fixed order, no absent keys. */
export function searchFactContent(fact: SearchFact): Record<string, unknown> {
  const content: Record<string, unknown> = {
    question: fact.question,
    tier: fact.tier,
    outcome: fact.outcome,
    candidates: fact.candidates.map((source) => ({ ...source })),
    used: fact.used.map((source) => ({ ...source })),
    durationMs: fact.durationMs,
  }
  if (fact.policy !== undefined) {
    content['policy'] = { ...fact.policy, allowedHosts: [...fact.policy.allowedHosts] }
  }
  if (fact.synthesis !== undefined) {
    content['synthesis'] = { ...fact.synthesis, used: [...fact.synthesis.used] }
  }
  if (fact.error !== undefined) content['error'] = fact.error
  return content
}
