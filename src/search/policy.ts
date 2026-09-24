/**
 * Which sources a lookup may read, and what class of source answered.
 *
 * The provider decides what to search; this module decides what the synthesis is
 * allowed to see, and it runs *after* the retrieval. It therefore filters what
 * the model is shown - never what the provider already read - which is why the
 * record keeps the candidates beside the allowed set.
 */
import { SearchOrigin, SearchTier, type SearchSource } from '../engine/search.ts'

/** GitHub and its raw/API hosts: the one source class worth naming on its own. */
const GITHUB_HOSTS = ['github.com', 'githubusercontent.com', 'github.io']

/** The host of a URL, lowercase and without a port; null when the URL carries none. */
export function hostOf(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  return parsed.hostname.toLowerCase().replace(/\.$/, '') || null
}

/** Whether a host is the pattern itself or a subdomain of it. */
export function hostMatches(host: string, pattern: string): boolean {
  return host === pattern || host.endsWith(`.${pattern}`)
}

/** Whether a host is on the list. */
export function hostAllowed(host: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => hostMatches(host, pattern))
}

/** The sources a policy allows: every source of the open tier, the allow-listed ones of the strict tier. */
export function allowedSources(
  sources: readonly SearchSource[],
  patterns: readonly string[],
  strict: boolean,
): SearchSource[] {
  if (!strict) return [...sources]
  return sources.filter((source) => {
    const host = hostOf(source.url)
    return host !== null && hostAllowed(host, patterns)
  })
}

/** The class of source an answer came from, for the model's own calibration. */
export function originOf(sources: readonly SearchSource[], tier: SearchTier): SearchOrigin {
  if (tier === SearchTier.Open) return SearchOrigin.Web
  const hosts = sources.map((source) => hostOf(source.url)).filter((host): host is string => host !== null)
  const github =
    sources.length > 0 &&
    hosts.length === sources.length &&
    hosts.every((host) => GITHUB_HOSTS.some((pattern) => hostMatches(host, pattern)))
  return github ? SearchOrigin.Github : SearchOrigin.Allowlist
}
