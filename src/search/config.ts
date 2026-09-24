/**
 * The policy one `search` row carries.
 *
 * Every field has a default, so a preset may name only what it wants to change,
 * and an unusable value is reported and replaced instead of refusing the row:
 * the preset must still mount - a wrong number must not cost the session its
 * calculator.
 */
import { SearchTier } from '../engine/search.ts'

/** The hosts a lookup may read when the preset names none: reference material a calculation may cite. */
export const DEFAULT_ALLOWED_HOSTS: readonly string[] = [
  'wikipedia.org',
  'github.com',
  'githubusercontent.com',
  'stackoverflow.com',
  'stackexchange.com',
  'developer.mozilla.org',
  'docs.python.org',
  'nist.gov',
  'iso.org',
  'ietf.org',
  'rfc-editor.org',
  'arxiv.org',
]

/** Where a lookup may read, how much it may read, and how it answers. */
export interface SearchConfig {
  readonly tier: SearchTier
  /** Host suffixes a strict lookup accepts; ignored by the open tier. */
  readonly allowedHosts: readonly string[]
  /** Upper bound on sources one provider call returns. */
  readonly maxResults: number
  /** How many lookups one record may carry. */
  readonly maxSearchesPerRecord: number
  /** Upper bound on the answer handed back to the model. */
  readonly answerMaxChars: number
  /** Whether the allowed pages are fetched for their text, beyond the provider's snippets. */
  readonly enrich: { readonly pages: number; readonly charsPerPage: number }
  /** The route the extractive step runs on; provider/model unset means the deployment default. */
  readonly synthesis: { readonly provider?: string; readonly model?: string; readonly maxTokens: number }
}

export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  tier: SearchTier.Strict,
  allowedHosts: DEFAULT_ALLOWED_HOSTS,
  maxResults: 12,
  maxSearchesPerRecord: 4,
  answerMaxChars: 1200,
  enrich: { pages: 0, charsPerPage: 4000 },
  synthesis: { maxTokens: 800 },
}

function positiveInt(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

/** One host pattern as matching uses it: lowercase, no scheme, no port, no leading wildcard. */
export function normalizeHostPattern(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\*\./, '')
    .replace(/^\./, '')
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
}

/**
 * Resolve one row's raw config into a usable policy.
 * @param input - the raw config object from the preset row (any shape).
 * @returns the resolved policy plus one sentence per value that was replaced.
 */
export function resolveSearchConfig(input: unknown): { config: SearchConfig; problems: string[] } {
  const problems: string[] = []
  if (input !== undefined && input !== null && (typeof input !== 'object' || Array.isArray(input))) {
    return { config: DEFAULT_SEARCH_CONFIG, problems: ['the search config must be an object; using every default'] }
  }
  const raw = (input ?? {}) as Record<string, unknown>

  let tier = DEFAULT_SEARCH_CONFIG.tier
  if (raw['tier'] !== undefined) {
    if (raw['tier'] === SearchTier.Strict || raw['tier'] === SearchTier.Open) {
      tier = raw['tier']
    } else {
      problems.push(`tier must be "strict" or "open"; using "${DEFAULT_SEARCH_CONFIG.tier}"`)
    }
  }

  let allowedHosts = DEFAULT_SEARCH_CONFIG.allowedHosts
  if (raw['allowedHosts'] !== undefined) {
    if (Array.isArray(raw['allowedHosts'])) {
      const patterns = raw['allowedHosts']
        .filter((entry): entry is string => typeof entry === 'string')
        .map(normalizeHostPattern)
        .filter((entry) => entry.length > 0)
      // An explicitly empty list is a decision, not a mistake: a strict lookup then answers nothing.
      allowedHosts = patterns
      if (patterns.length !== raw['allowedHosts'].length) problems.push('allowedHosts keeps only non-empty strings')
    } else {
      problems.push('allowedHosts must be a list of host suffixes; using the default list')
    }
  }

  const enrichRaw = (raw['enrich'] ?? {}) as Record<string, unknown>
  const synthesisRaw = (raw['synthesis'] ?? {}) as Record<string, unknown>
  const provider = typeof synthesisRaw['provider'] === 'string' && synthesisRaw['provider'].length > 0 ? synthesisRaw['provider'] : undefined
  const model = typeof synthesisRaw['model'] === 'string' && synthesisRaw['model'].length > 0 ? synthesisRaw['model'] : undefined

  return {
    config: {
      tier,
      allowedHosts,
      maxResults: positiveInt(raw['maxResults'], DEFAULT_SEARCH_CONFIG.maxResults, 1, 50),
      maxSearchesPerRecord: positiveInt(raw['maxSearchesPerRecord'], DEFAULT_SEARCH_CONFIG.maxSearchesPerRecord, 1, 50),
      answerMaxChars: positiveInt(raw['answerMaxChars'], DEFAULT_SEARCH_CONFIG.answerMaxChars, 120, 10_000),
      enrich: {
        pages: positiveInt(enrichRaw['pages'], DEFAULT_SEARCH_CONFIG.enrich.pages, 0, 10),
        charsPerPage: positiveInt(enrichRaw['charsPerPage'], DEFAULT_SEARCH_CONFIG.enrich.charsPerPage, 200, 50_000),
      },
      synthesis: {
        ...(provider === undefined ? {} : { provider }),
        ...(model === undefined ? {} : { model }),
        maxTokens: positiveInt(synthesisRaw['maxTokens'], DEFAULT_SEARCH_CONFIG.synthesis.maxTokens, 128, 8192),
      },
    },
    problems,
  }
}
