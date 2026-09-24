/**
 * Host half of dsh-reckoner.
 *
 * One process-wide engine (slots + records), its tool surface, the two skills,
 * the packaged preset and the records endpoints the panel reads. The engine
 * holds no domain knowledge: the model writes every formula, the engine
 * parses, checks dimensions, evaluates and records.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from 'cordis'
import { Engine } from './engine/engine.ts'
import { createEngineTools } from './tools/engine-tools.ts'
import { recordFacts, type GenerationFacts } from './generate.ts'
import { registerGenerateEndpoints } from './generate-server.ts'
import { registerSkills } from './skill.ts'
import { installPresets } from './preset.ts'
import { lookup } from './search/lookup.ts'
import type { ReckonerSearchService } from './search/service.ts'
import { attachConsoleSink, attachFileSink, log, resolveLevel, setLevel } from './log.ts'

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-reckoner'

/** Services required before mounting: the tool registry and the web server (endpoint host). */
export const inject = ['tools', 'webServer']

declare module 'cordis' {
  interface Context {
    /** The web server the record endpoints register on. */
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

/** The records home: records/ (closed records) and open-record.jsonl live here. */
const recordsHome = process.env.DSH_RECKONER_HOME ?? join(homedir(), '.dsh-reckoner')

/** Global single engine: one engine per process; any session's markers act on it. */
export const engine = new Engine(recordsHome)

const RECORDS_INDEX_PATH = '/api/dsh-reckoner/records-index'
// WebRoute paths carry no trailing slash; requests are /records/<id>.
const RECORDS_BODY_PREFIX = '/api/dsh-reckoner/records'

/** The article facts of one closed record, or undefined when it does not exist or is still open. */
function loadGenerationRecord(id: string): GenerationFacts | undefined {
  if (engine.openRecordId() === id) return undefined
  const record = engine.readRecordRows(id)
  return record === null ? undefined : recordFacts(record.rows)
}

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

  // The lookup seam: the `search` row of the `reckoner-with-search` preset owns
  // the model-facing tool and the policy; everything the call actually does -
  // provider, extractive step, record - happens here, against this engine, so a
  // lookup lands in the same record as the calculation it belongs to.
  ctx.effect(() => {
    const service: ReckonerSearchService = {
      lookup: (request, config) =>
        lookup(
          {
            engine,
            get: (serviceName) => ctx.get(serviceName) as unknown,
            warn: (message, fields) => log.warn(message, fields),
          },
          config,
          request,
        ),
    }
    const dispose = ctx.provide('reckonerSearch', service)
    // Logged because the preset row can be mounted without this half: the row's
    // own receipt then reports the service as missing, and this line is how a log
    // tells "never published" from "published in another process".
    log.info('search service published', { pid: process.pid })
    return dispose
  }, 'dsh-reckoner: search service')

  ctx.effect(() => {
    const disposers: Array<() => void> = []

    // Record list: the closed records scanned from records/, the unclosed record
    // from engine state, and how many files carry no header or an older version.
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
        res.end(JSON.stringify(engine.listRecords()))
      }),
    }))

    // Record body: GET /api/dsh-reckoner/records/<id> - one record's identity and
    // trace rows (the unclosed record included, with endedAt null); DELETE removes
    // a closed record. The unclosed record cannot be deleted.
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
          res.end(JSON.stringify({ error: 'a record identifier is required' }))
          return
        }
        if (method === 'DELETE') {
          if (engine.openRecordId() === id) {
            res.statusCode = 409
            res.end(JSON.stringify({ error: `record "${id}" is not closed - call record_end for it first` }))
            return
          }
          if (!engine.store.hasRecord(id)) {
            res.statusCode = 404
            res.end(JSON.stringify({ error: `no record "${id}"` }))
            return
          }
          engine.deleteRecord(id)
          res.end(JSON.stringify({ deleted: true }))
          return
        }
        if (method !== 'GET') {
          res.statusCode = 405
          res.end('method not allowed')
          return
        }
        const record = engine.readRecordRows(id)
        const summary = record === null ? null : engine.summarize(id)
        if (record === null || summary === null) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: `no record "${id}"` }))
          return
        }
        res.end(JSON.stringify({
          id,
          version: record.version,
          title: summary.title,
          openedAt: summary.openedAt,
          endedAt: engine.openRecordId() === id ? null : summary.endedAt,
          rows: record.rows,
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
