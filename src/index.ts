/**
 * Host half of dsh-reckoner.
 *
 * One process-wide engine (slots + records), its tool surface, the two skills
 * and the packaged preset. The engine holds no domain knowledge: the model
 * writes every formula, the engine parses, checks dimensions, evaluates and
 * records.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from 'cordis'
import { Engine } from './engine/engine.ts'
import { createEngineTools } from './tools/engine-tools.ts'
import { registerSkills } from './skill.ts'
import { installPresets } from './preset.ts'
import { attachConsoleSink, attachFileSink, log, resolveLevel, setLevel } from './log.ts'

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-reckoner'

/** Services required before mounting: the tool registry. */
export const inject = ['tools']

/** The records home: records/ and record-index.jsonl live here. */
const recordsHome = process.env.DSH_RECKONER_HOME ?? join(homedir(), '.dsh-reckoner')

/** Global single engine: one engine per process; any session's markers act on it. */
export const engine = new Engine(recordsHome)

export function apply(ctx: Context): void {
  // Logging: one line per event on stdout, plus one file per host run. The level is the single knob
  // (DSH_RECKONER_LOG_LEVEL); a log file that cannot be created is reported and skipped - logging
  // must never keep the plugin from mounting.
  const level = resolveLevel(process.env.DSH_RECKONER_LOG_LEVEL)
  setLevel(level)
  ctx.effect(() => {
    const startedAt = Date.now()
    const detachConsole = attachConsoleSink()
    let run: { file: string; close(): void } | undefined
    try {
      run = attachFileSink(recordsHome)
    } catch (error) {
      log.warn('log file sink unavailable', { home: recordsHome, error })
    }
    log.info('plugin mounted', { home: recordsHome, file: run?.file ?? null, pid: process.pid, level })
    return () => {
      log.info('plugin unmounted', { uptime_ms: Date.now() - startedAt })
      if (run !== undefined) run.close()
      detachConsole()
    }
  }, 'dsh-reckoner: logger')

  ctx.effect(() => {
    const disposers: Array<() => void> = []
    // Recover the open record before anything can read or write a slot.
    engine.start()
    for (const tool of createEngineTools(engine)) {
      disposers.push(ctx.tools.register(tool))
    }
    return () => {
      for (const off of disposers) off()
    }
  }, 'dsh-reckoner: engine')

  ctx.effect(() => registerSkills(ctx), 'dsh-reckoner: skills')

  try {
    const synced = installPresets()
    if (synced.length > 0) log.info('presets synced', { count: synced.length })
  } catch (error) {
    // A preset that fails to sync must never break the plugin.
    log.warn('preset sync failed', { error })
  }
}
