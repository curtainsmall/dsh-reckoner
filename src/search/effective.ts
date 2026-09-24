/**
 * The one place that decides which search policy is in force.
 *
 * Three layers, each able to name only what it cares about:
 *
 * 1. the code defaults (`DEFAULT_SEARCH_CONFIG`),
 * 2. the preset row's own config - what a preset ships as its boundary,
 * 3. the user's override in the plugin state - what the Reckoner settings tab writes.
 *
 * Resolution happens per call, not at mount, which is what lets a settings write reach the next
 * lookup without a restart and without a new session. The row reports its own config on every call,
 * so the host also keeps the last one it saw: the settings view shows it as "shipped by the preset",
 * next to the override and the effective value.
 */
import type { SearchConfig } from './config.ts'
import { DEFAULT_SEARCH_CONFIG, layerSearchConfig, resolveSearchConfig } from './config.ts'
import { readSection, type SearchPolicyOverride } from '../state.ts'

/** The last row config seen in this process, for the settings view. */
let lastRowConfig: unknown

/** What one resolved policy looks like when it is explained instead of used. */
export interface SearchPolicyView {
  /** The code defaults: what an unconfigured row would run with. */
  readonly defaults: SearchConfig
  /** The raw config of the preset row, when a search row has been mounted and used. */
  readonly preset: unknown
  /** The user's override, field by field; absent fields fall back below. */
  readonly override: SearchPolicyOverride
  /** What the next lookup will actually use. */
  readonly effective: SearchConfig
}

/**
 * Resolve the policy for one call: the preset row's config, layered under the user's override.
 * @param home - the plugin home holding the state file.
 * @param rowConfig - the raw config of the calling row; remembered for the settings view.
 */
export function resolveEffectiveSearchPolicy(home: string, rowConfig: unknown): SearchConfig {
  if (rowConfig !== undefined && rowConfig !== null) lastRowConfig = rowConfig
  const base = resolveSearchConfig(lastRowConfig).config
  return layerSearchConfig(base, readSection(home, 'search'))
}

/** The three layers beside the effective policy, for the settings page. */
export function searchPolicyView(home: string): SearchPolicyView {
  const override = readSection(home, 'search') as SearchPolicyOverride
  const base = resolveSearchConfig(lastRowConfig).config
  return {
    defaults: DEFAULT_SEARCH_CONFIG,
    preset: lastRowConfig ?? null,
    override,
    effective: layerSearchConfig(base, override),
  }
}
