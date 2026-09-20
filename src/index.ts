/**
 * Host half of dsh-reckoner.
 *
 * One process-wide global engine (Engine): variable table + record storage.
 * apply assembly: registers the LLM tool surface (set/get/eval + markers) and
 * mounts the record and article-generation endpoints.
 * The engine holds no domain knowledge: the model supplies the formula.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from 'cordis'
import { Engine } from './engine/engine.ts'
import { recordFacts } from './engine/record-facts.ts'
import { createEngineTools } from './tools/engine-tools.ts'
import type { Record } from './generate.ts'
import { registerGenerateEndpoints } from './generate-server.ts'
import { registerSkills } from './skill.ts'
import { installPresets } from './preset.ts'
import { attachConsoleSink, attachFileSink, log, resolveLevel, setLevel } from './log.ts'

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-reckoner'

/** Services required before mounting: the tool registry and the web server (endpoint host). */
export const inject = ['tools', 'webServer']

declare module 'cordis' {
  interface Context {
    /** The web server the endpoints register on. */
    webServer: WebServerLike
  }
}
/** Minimal structural shape of the web-server response the handlers write to. */
interface WebResponseLike {
  statusCode?: number
  setHeader(name: string, value: string): void
  end(body: string): void
}

/** Minimal structural shape of the web-server route registry. */
interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler(req: unknown, res: WebResponseLike): void | Promise<void>
  }): () => void
}

type RouteHandler = (req: unknown, res: WebResponseLike) => void | Promise<void>

/** An unexpected endpoint throw is logged before it reaches the web server; behavior is unchanged. */
function guard(path: string, handler: RouteHandler): RouteHandler {
  return (req, res) => {
    try {
      const pending = handler(req, res)
      if (pending instanceof Promise) {
        return pending.catch((error: unknown) => {
          log.error('endpoint failed', { path, error })
          throw error
        })
      }
      return pending
    } catch (error) {
      log.error('endpoint failed', { path, error })
      throw error
    }
  }
}

interface RequestLike {
  method?: string
  url?: string
}

/** The records home: records/ + record-index.jsonl live here. */
const recordsHome = process.env.DSH_RECKONER_HOME ?? join(homedir(), '.dsh-reckoner')

/** Global single engine: one engine per process; any session's markers act on it. */
export const engine = new Engine(recordsHome)

const RECORDS_INDEX_PATH = '/api/dsh-reckoner/records-index'
// WebRoute paths carry no trailing slash; requests are /records/<id>.
const RECORDS_BODY_PREFIX = '/api/dsh-reckoner/records'

/** The article-generation facts of one stored record, or undefined when it does not exist. */
function loadGenerationRecord(id: string): Record | undefined {
  const meta = engine.indexRows().find((row) => row.id === id)
  if (meta === undefined) return undefined
  return recordFacts(meta, engine.store.readRows(id))
}

export function apply(ctx: Context): void {
  // Logging: one line per event on stdout, plus one file per host run. The level is the single
  // knob (DSH_RECKONER_LOG_LEVEL); a log file that cannot be created is reported and
  // skipped — logging must never keep the plugin from mounting.
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
    // The run is described entirely by its log file: `file` names it, `pid` says which host process
    // wrote it, and the closing `plugin unmounted` line says it ended instead of dying.
    log.info('plugin mounted', { home: recordsHome, file: run?.file ?? null, pid: process.pid, level })

    return () => {
      log.info('plugin unmounted', { uptime_ms: Date.now() - startedAt })
      if (run !== undefined) run.close()
      detachConsole()
    }
  }, 'dsh-reckoner: logger')

  ctx.effect(() => {
    const disposers: Array<() => void> = []

    // Engine wiring: recover the open record (clear orphans + rebuild the table).
    // There is nothing to register — the engine holds no domain knowledge.
    engine.start()

    // LLM tool surface: engine primitives + markers.
    for (const tool of createEngineTools(engine)) {
      disposers.push(ctx.tools.register(tool))
    }

    return () => {
      for (const off of disposers) off()
    }
  }, 'dsh-reckoner: engine')

  ctx.effect(() => registerSkills(ctx), 'dsh-reckoner: skills')

  ctx.effect(() => {
    const disposers: Array<() => void> = []

    // Record list: read record-index.jsonl (the list page's only data source).
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: RECORDS_INDEX_PATH,
      handler: guard(RECORDS_INDEX_PATH, (req, res) => {
        const request = req as RequestLike
        if ((request.method ?? 'GET') !== 'GET') {
          res.statusCode = 405
          res.end('method not allowed')
          return
        }
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ rows: engine.indexRows() }))
      }),
    }))

    // Record body: GET /api/dsh-reckoner/records/<id> — one record's trace
    // rows plus its index meta (question/openedAt/sealedAt); DELETE removes a
    // record (body + index row). The currently open record cannot be deleted.
    disposers.push(ctx.webServer.register({
      kind: 'prefix',
      path: RECORDS_BODY_PREFIX,
      handler: guard(RECORDS_BODY_PREFIX, (req, res) => {
        const request = req as RequestLike
        const method = request.method ?? 'GET'
        res.setHeader('content-type', 'application/json')
        const path = request.url === undefined ? '' : request.url.split('?')[0] ?? ''
        const id = path.startsWith(`${RECORDS_BODY_PREFIX}/`) ? path.slice(RECORDS_BODY_PREFIX.length + 1) : ''
        if (id.length === 0) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'a record id is required' }))
          return
        }
        if (method === 'DELETE') {
          if (engine.openId() === id) {
            res.statusCode = 409
            res.end(JSON.stringify({ error: `record "${id}" is open — finish or settle it first` }))
            return
          }
          const meta = engine.indexRows().find((row) => row.id === id)
          if (meta === undefined) {
            res.statusCode = 404
            res.end(JSON.stringify({ error: `no record "${id}"` }))
            return
          }
          engine.store.deleteRecord(id)
          res.end(JSON.stringify({ deleted: true }))
          return
        }
        if (method !== 'GET') {
          res.statusCode = 405
          res.end('method not allowed')
          return
        }
        const meta = engine.indexRows().find((row) => row.id === id)
        if (meta === undefined || !engine.store.hasRecord(id)) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: `no record "${id}"` }))
          return
        }
        res.end(JSON.stringify({
          id,
          openedAt: meta.openedAt,
          sealedAt: meta.sealedAt,
          question: meta.question,
          rows: engine.store.readRows(id),
        }))
      }),
    }))

    // Article generation subsystem (LLM jobs, file writing, compile, browsing).
    disposers.push(registerGenerateEndpoints(ctx as never, {
      home: recordsHome,
      loadRecord: loadGenerationRecord,
    }))

    return () => {
      for (const off of disposers) off()
    }
  }, 'dsh-reckoner: web')

  try {
    const synced = installPresets()
    if (synced.length > 0) log.info('presets synced', { count: synced.length })
  } catch (error) {
    // A preset that fails to sync must never break the plugin.
    log.warn('preset sync failed', { error })
  }
}
