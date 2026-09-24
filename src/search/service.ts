/**
 * The seam between the two halves of the search feature.
 *
 * The host half owns the engine, the provider call and the extractive step; the
 * preset row owns the model-facing tool and the policy. They are different
 * modules mounted at different scopes, so the host half publishes this one
 * method and the row resolves it - which is also what keeps the tool out of
 * every session that does not mount the row.
 */
import type { SearchConfig } from './config.ts'
import type { LookupReceipt } from './lookup.ts'

/** What one lookup call carries: the question as the model asked it, and the call's abort signal. */
export interface SearchLookupRequest {
  readonly question: string
  readonly signal?: AbortSignal
}

/** The host half's search surface. */
export interface ReckonerSearchService {
  /**
   * The policy a call may run under: the row's own config, layered under the user's override from
   * the plugin state. It is resolved per call, so a settings write reaches the next lookup without
   * a restart and without a new session.
   * @param rowConfig - the raw `config` of the calling preset row.
   */
  resolvePolicy(rowConfig: unknown): SearchConfig
  lookup(request: SearchLookupRequest, config: SearchConfig): Promise<LookupReceipt>
}

declare module 'cordis' {
  interface Context {
    /** Published by the dsh-reckoner host half; absent when only the preset row is mounted. */
    reckonerSearch: ReckonerSearchService
  }
}
