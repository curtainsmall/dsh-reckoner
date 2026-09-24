/**
 * The plugin's one state file: `<home>/state.json`.
 *
 * Everything the plugin carries across host runs that is not a record lives in this single root
 * file. It is a tree: one subtree per module that remembers settings, plus the few flat keys that
 * concern the whole plugin. The split is deliberate:
 *
 * - `generation` - owned by the generation subsystem: one subtree per article format, because the
 *   two formats remember different things (`compile` only means anything for LaTeX);
 * - `search` - owned by the search policy: the user's override over the values a preset ships;
 * - `panel` - owned by the panel's own preferences;
 * - `restartRequired` - flat, and not a setting at all: a fact about this host run, set by whatever
 *   changed something the running host only reads at its next mount.
 *
 * Two rules keep the file honest as it grows. First, absence means "use the default": only a value
 * someone actually chose is stored, so the file stays small and needs no retention. That is also
 * why `restartRequired: false` is never written - absent and false are the same fact here, while a
 * remembered `false` (an unticked box) is a real choice and is kept. Second, a writer touches only
 * its own subtree; every other key - including keys written by a newer build - survives verbatim.
 *
 * The file is replaced atomically (write a temporary file, then rename it over the target), so a
 * crash mid-write leaves the previous file intact rather than a truncated one. A missing, corrupt
 * or non-object file reads as {}. Records are not state and live elsewhere: records/<id>.jsonl
 * holds each closed record's trace (the list is derived by scanning that directory) and
 * open-record.jsonl holds the one unclosed record.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Base name of the one state file (inside the records home). */
export const STATE_FILE = 'state.json'

/** The tree shape this build writes; a file version above it is left alone. */
export const STATE_SCHEMA = 1

/** The plugin's own home: records, logs and this state file live here. */
export function reckonerHome(): string {
  return process.env['DSH_RECKONER_HOME'] ?? join(homedir(), '.dsh-reckoner')
}

/** What one article format remembers: where it writes, in which language, and (LaTeX only) whether to compile. */
export interface GenerationFormatState {
  directory?: string
  language?: string
  compile?: boolean
}

/** The generation subsystem's subtree: one entry per article format. */
export interface GenerationState {
  markdown?: GenerationFormatState
  latex?: GenerationFormatState
}

/**
 * The search policy the user overrode, field by field. An absent field falls back to what the
 * preset row ships, which in turn falls back to the code defaults - so this is an override layer,
 * never a complete policy.
 */
export interface SearchPolicyOverride {
  tier?: string
  allowedHosts?: string[]
  maxResults?: number
  maxSearchesPerRecord?: number
  answerMaxChars?: number
  enrich?: { pages?: number; charsPerPage?: number }
  synthesis?: { provider?: string; model?: string; maxTokens?: number }
}

/** The panel's own preferences. */
export interface PanelState {
  showAll?: boolean
}

/** The state object as stored: the known subtrees, the flat markers, and anything a newer build wrote. */
export interface PluginState {
  schema?: number
  generation?: GenerationState
  search?: SearchPolicyOverride
  panel?: PanelState
  restartRequired?: boolean
  [key: string]: unknown
}

/** The three setting subtrees, each owned by one module. */
export type StateSection = 'generation' | 'search' | 'panel'

export function statePath(home: string): string {
  return join(home, STATE_FILE)
}

function isBag(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asBag(value: unknown): Record<string, unknown> {
  return isBag(value) ? value : {}
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** One format's remembered values: only the fields that are the right type survive. */
function readFormatState(value: unknown): GenerationFormatState {
  const bag = asBag(value)
  const state: GenerationFormatState = {}
  if (isText(bag['directory'])) state.directory = bag['directory']
  if (isText(bag['language'])) state.language = bag['language']
  if (typeof bag['compile'] === 'boolean') state.compile = bag['compile']
  return state
}

/**
 * The file as the rest of the plugin reads it: known fields validated, unknown keys preserved.
 * A subtree whose value is not an object reads as absent rather than as an error.
 */
function normalize(raw: Record<string, unknown>): PluginState {
  const state: PluginState = { ...raw }
  const generation = asBag(raw['generation'])
  if (isBag(raw['generation'])) {
    const subtree: GenerationState = {}
    if (isBag(generation['markdown'])) subtree.markdown = readFormatState(generation['markdown'])
    if (isBag(generation['latex'])) subtree.latex = readFormatState(generation['latex'])
    state.generation = subtree
  }
  if (isBag(raw['search'])) state.search = raw['search'] as SearchPolicyOverride
  if (isBag(raw['panel'])) state.panel = raw['panel'] as PanelState
  if (raw['restartRequired'] !== true) delete state.restartRequired
  return state
}

/**
 * Bring a file written by an older build into the tree, in one direction and idempotently.
 *
 * The flat generation keys predate the tree; the single directory and language they hold are copied
 * into both formats because nothing says which one they meant, `generateCompile` goes to LaTeX only
 * because that is the one format it can mean, and `generateFormat` is dropped - it was written but
 * never read. `restartRequired` keeps its place: it was always flat.
 */
export function migrateState(raw: unknown): { state: PluginState; changed: boolean } {
  if (!isBag(raw)) return { state: {}, changed: false }
  const migrated: Record<string, unknown> = { ...raw }
  let changed = false

  const directory = isText(raw['generateDir']) ? raw['generateDir'] : undefined
  const language = isText(raw['generateLanguage']) ? raw['generateLanguage'] : undefined
  const compile = typeof raw['generateCompile'] === 'boolean' ? raw['generateCompile'] : undefined
  const legacy = directory !== undefined || language !== undefined || compile !== undefined
    || raw['generateFormat'] !== undefined
  if (legacy) {
    const generation = asBag(migrated['generation'])
    const markdown = readFormatState(generation['markdown'])
    const latex = readFormatState(generation['latex'])
    if (directory !== undefined) {
      if (markdown.directory === undefined) markdown.directory = directory
      if (latex.directory === undefined) latex.directory = directory
    }
    if (language !== undefined) {
      if (markdown.language === undefined) markdown.language = language
      if (latex.language === undefined) latex.language = language
    }
    if (compile !== undefined && latex.compile === undefined) latex.compile = compile
    migrated['generation'] = { ...generation, markdown, latex }
    delete migrated['generateDir']
    delete migrated['generateLanguage']
    delete migrated['generateCompile']
    delete migrated['generateFormat']
    changed = true
  }

  // The schema number only ever climbs: a file a newer build wrote keeps its number (and every key
  // this build does not know), so an older reader can never downgrade it.
  const version = typeof raw['schema'] === 'number' && Number.isFinite(raw['schema']) ? raw['schema'] : undefined
  if (version === undefined || version < STATE_SCHEMA) {
    migrated['schema'] = STATE_SCHEMA
    changed = true
  }
  return { state: normalize(migrated), changed }
}

/** The current state, migrated in memory; anything unreadable reads as {} (never throws). */
export function readState(home: string): PluginState {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(statePath(home), 'utf8')) as unknown
  } catch {
    return {}
  }
  return migrateState(parsed).state
}

/** Replace the file atomically: the temporary file is renamed over the target on the same volume. */
function persist(home: string, state: PluginState): void {
  mkdirSync(home, { recursive: true })
  const file = statePath(home)
  const temporary = `${file}.tmp`
  writeFileSync(temporary, JSON.stringify({ ...state, schema: STATE_SCHEMA }), 'utf8')
  renameSync(temporary, file)
}

/**
 * Read-modify-write the state file: `change` receives the current state and mutates the keys it
 * owns. Unrelated keys are preserved, and the result is written atomically. Returns the state that
 * was written.
 */
export function updateState(home: string, change: (state: PluginState) => void): PluginState {
  const state = readState(home)
  change(state)
  persist(home, state)
  return state
}

/** One settings subtree, defaulted to an empty object so a caller can read fields directly. */
export function readSection<K extends StateSection>(home: string, section: K): NonNullable<PluginState[K]> {
  return (readState(home)[section] ?? {}) as NonNullable<PluginState[K]>
}

/**
 * Write one settings subtree. Only the named subtree changes; every other key - including subtrees
 * this build does not know - is preserved verbatim. The change callback mutates the subtree it is
 * given, and an empty result removes the key rather than storing `{}`.
 */
export function updateSection<K extends StateSection>(home: string, section: K, change: (value: NonNullable<PluginState[K]>) => void): PluginState {
  return updateState(home, (state) => {
    const current = (state[section] ?? {}) as NonNullable<PluginState[K]>
    change(current)
    if (isBag(current) && Object.keys(current).length === 0) delete state[section]
    else state[section] = current
  })
}

/**
 * Rewrite the file once when it still carries anything an older build wrote, so a migrated file
 * converges without every reader writing. Returns whether it wrote.
 */
export function migrateStateFile(home: string): boolean {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(statePath(home), 'utf8')) as unknown
  } catch {
    return false
  }
  const { state, changed } = migrateState(parsed)
  if (!changed) return false
  persist(home, state)
  return true
}

/* ── the pending-restart flag ──────────────────────────────────────────────── */

/**
 * The flat flag a writer sets when it changed something the running host only reads at its next
 * mount, so a surface can say "restart to apply this" before the restart happens. It stays flat
 * rather than moving into a subtree: it is not any module's remembered setting, it belongs to the
 * whole plugin, and every reader - the mount, the settings page - looks at one top-level field.
 *
 * A host restart is the event the flag describes, so every mount consumes it: the clear is
 * unconditional and must not depend on whatever set it. The key is absent while nothing is pending.
 */
export const RESTART_REQUIRED_KEY = 'restartRequired'

/** Whether a change is waiting for the next host mount. Absent, corrupt or non-`true` reads as false. */
export function restartRequired(home: string): boolean {
  return readState(home)[RESTART_REQUIRED_KEY] === true
}

/** Mark a change as pending: it takes effect at the next mount. Idempotent, and every other key survives. */
export function markRestartRequired(home: string): void {
  updateState(home, (state) => {
    state[RESTART_REQUIRED_KEY] = true
  })
}

/**
 * Consume the flag; the mount itself calls this. A file that does not carry the key is left
 * untouched, so an ordinary mount writes nothing.
 */
export function clearRestartRequired(home: string): void {
  if (readState(home)[RESTART_REQUIRED_KEY] === undefined) return
  updateState(home, (state) => {
    delete state[RESTART_REQUIRED_KEY]
  })
}
