/**
 * The plugin's one state file: `<home>/state.json`.
 *
 * Everything the plugin carries across host runs that is not a record lives in this single root
 * file: the remembered generation settings and the restart dirty bit for external declarations.
 * Logging is not state and never writes here — a run is described by its own log file. Two modules
 * share this file, so this module owns the read-modify-write: a writer names only the keys it owns
 * and every other key survives. Every key is a current value, so the file stays small and needs no
 * retention.
 *
 * The file is replaced atomically (write a temporary file, then rename it over the target), so a
 * crash mid-write leaves the previous file intact rather than a truncated one. A missing, corrupt
 * or non-object file reads as {} — every reader tolerates that. Records are not state and live
 * elsewhere: record-index.jsonl indexes them (it is what the client's record list previews) and
 * records/<id>.jsonl holds their traces.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Base name of the one state file (inside the records home). */
export const STATE_FILE = 'state.json'

/** The state object as stored: flat keys, each owned by one module. */
export type PluginState = Record<string, unknown>

export function statePath(home: string): string {
  return join(home, STATE_FILE)
}

/** The current state; anything unreadable reads as {} (never throws). */
export function readState(home: string): PluginState {
  try {
    const parsed = JSON.parse(readFileSync(statePath(home), 'utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return parsed as PluginState
  } catch {
    return {}
  }
}

/** Replace the file atomically: the temporary file is renamed over the target on the same volume. */
function persist(home: string, state: PluginState): void {
  mkdirSync(home, { recursive: true })
  const file = statePath(home)
  const temporary = `${file}.tmp`
  writeFileSync(temporary, JSON.stringify(state), 'utf8')
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
