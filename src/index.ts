/**
 * Host half of dsh-electro-lab (engine era).
 *
 * One process-wide global engine (Engine): variable table + solver registry + record storage.
 * apply assembly: registers the kernel and external solvers, registers the LLM tool surface (set/get/call +
 * markers) and the declaration management tools (external_solver_add/update/delete), and mounts two
 * endpoints (record index, external solver archive management).
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from 'cordis'
import { Engine } from './engine/engine.ts'
import { createEngineTools } from './tools/engine-tools.ts'
import { createDeclarationTools } from './tools/declaration-tools.ts'
import { compileExternalSolver } from './engine/external-solvers.ts'
import { registerKernelSolvers } from './engine/solvers/index.ts'
import type { GenerationCall, GenerationResult, Record } from './generate.ts'
import {
  clearRestartRequired,
  deleteDeclaration,
  readDeclarations,
  restartRequired,
  upsertDeclaration,
  validateDeclaration,
} from './tool.ts'
import { registerGenerateEndpoints } from './generate-server.ts'
import { registerSkills } from './skill.ts'
import { installPresets } from './preset.ts'
import { attachConsoleSink, attachFileSink, log, resolveLevel, setLevel } from './log.ts'

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-electro-lab'

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
const recordsHome = process.env.DSH_ELECTRO_LAB_HOME ?? join(homedir(), '.dsh-electro-lab')

/**
 * External solver gate. When false, external solver functionality is disabled:
 * declarations are never compiled into the registry, the manager tools
 * (external_solver_add/update/delete) are not registered, and the archive
 * endpoint is not mounted. All code stays in place — flip this to true to
 * re-enable the feature.
 */
const EXTERNAL_SOLVERS_ENABLED = false

/** Global single engine: one engine per process; any session's markers act on it. */
export const engine = new Engine(recordsHome)

const RECORDS_INDEX_PATH = '/api/dsh-electro-lab/records-index'
// WebRoute paths carry no trailing slash; requests are /records/<id>.
const RECORDS_BODY_PREFIX = '/api/dsh-electro-lab/records'
const EXTERNAL_PATH = '/api/dsh-electro-lab/external-solvers'

/**
 * Flatten one stored engine record into the article-generation facts: the
 * question, established conditions, analysis notes, successful solver steps
 * with their resolved arguments and results, and the final answer. Failed
 * attempts and introspection rows are skipped.
 */
function loadGenerationRecord(id: string): Record | undefined {
  const meta = engine.indexRows().find((row) => row.id === id)
  if (meta === undefined) return undefined
  const conditions: string[] = []
  const notes: string[] = []
  const calls: GenerationCall[] = []
  const results: GenerationResult[] = []
  let answer = ''
  for (const row of engine.store.readRows(id)) {
    if (row.ok !== true) continue
    if (row.tool === 'marker') {
      const text = typeof row.text === 'string' ? row.text.trim() : ''
      if (text.length === 0) continue
      if (row.kind === 'analyse') notes.push(text)
      else if (row.kind === 'answer') answer = text
      continue
    }
    if (row.tool === 'set') {
      const name = typeof row.name === 'string' ? row.name : ''
      if (row.deleted === true) conditions.push(`${name}: removed`)
      else conditions.push(`${name}: ${JSON.stringify(row.value)}`)
      continue
    }
    if (row.tool === 'call' && typeof row.solver === 'string') {
      const callId = String(row.seq)
      calls.push({
        callId,
        name: row.solver,
        arguments: JSON.stringify(row.resolved ?? row.args ?? {}),
      })
      if (row.result !== null && row.result !== undefined) {
        results.push({ callId, content: JSON.stringify(row.result) })
      }
    }
  }
  const analyse = [
    conditions.length > 0 ? `Established conditions:\n${conditions.map((line) => `- ${line}`).join('\n')}` : '',
    ...notes,
  ].filter((line) => line.length > 0).join('\n\n')
  return { id, question: meta.question, analyse, answer, calls, results }
}

export function apply(ctx: Context): void {
  // Logging: one line per event on stdout, plus one file per host run. The level is the single
  // knob (DSH_ELECTRO_LAB_LOG_LEVEL); a log file that cannot be created is reported and
  // skipped — logging must never keep the plugin from mounting.
  const level = resolveLevel(process.env.DSH_ELECTRO_LAB_LOG_LEVEL)
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
  }, 'dsh-electro-lab: logger')

  ctx.effect(() => {
    const disposers: Array<() => void> = []

    // Engine wiring: recover the open record (clear orphans + rebuild the table), register all kernel and external solvers.
    engine.start()
    for (const solver of registerKernelSolvers()) {
      if (engine.registry.get(solver.id) === undefined) engine.registry.register(solver)
    }
    if (EXTERNAL_SOLVERS_ENABLED) {
      // External solvers: every enabled declaration in the archive is compiled
      // into the registry at start (changes apply on the next host restart).
      for (const declaration of readDeclarations(recordsHome)) {
        if (declaration.enabled === false) continue
        try {
          const solver = compileExternalSolver(declaration)
          if (solver !== null && engine.registry.get(solver.id) === undefined) engine.registry.register(solver)
        } catch (error) {
          log.warn('declaration skipped', { solver: declaration.name, error })
        }
      }
      // Declarations have just been registered: clear the restart dirty bit.
      clearRestartRequired(recordsHome)
    }

    // LLM tool surface: engine primitives + markers.
    for (const tool of createEngineTools(engine)) {
      disposers.push(ctx.tools.register(tool))
    }
    // Declaration management tools (the management surface lives outside the engine).
    if (EXTERNAL_SOLVERS_ENABLED) {
      for (const tool of createDeclarationTools(recordsHome)) {
        disposers.push(ctx.tools.register(tool))
      }
    }

    return () => {
      for (const off of disposers) off()
    }
  }, 'dsh-electro-lab: engine')

  ctx.effect(() => registerSkills(ctx), 'dsh-electro-lab: skills')

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

    // Record body: GET /api/dsh-electro-lab/records/<id> — one record's trace
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

    // External solver archive management: GET lists + dirty bit; PUT overwrites/adds (base64 JSON query parameter);
    // DELETE ?name= removes. Every write sets the dirty bit (registered via compileExternalSolver after a restart).
    if (EXTERNAL_SOLVERS_ENABLED) {
      disposers.push(ctx.webServer.register({
        kind: 'exact',
        path: EXTERNAL_PATH,
        handler: guard(EXTERNAL_PATH, (req, res) => {
          const request = req as RequestLike
          const method = request.method ?? 'GET'
          res.setHeader('content-type', 'application/json')
          if (method === 'PUT') {
            const encoded = request.url === undefined ? null : new URL(request.url, 'http://dsh.local').searchParams.get('config')
            if (encoded === null) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'config parameter is required (base64 JSON)' }))
              return
            }
            let config: unknown
            try {
              config = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
            } catch {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'config is not valid base64 JSON' }))
              return
            }
            const errors = validateDeclaration(config)
            if (errors.length > 0) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: errors.join('; ') }))
              return
            }
            upsertDeclaration(recordsHome, config as never)
            res.end(JSON.stringify({ saved: true, restartRequired: true }))
            return
          }
          if (method === 'DELETE') {
            const name = request.url === undefined ? null : new URL(request.url, 'http://dsh.local').searchParams.get('name')
            const deleted = name !== null && deleteDeclaration(recordsHome, name)
            res.end(JSON.stringify({ deleted, restartRequired: restartRequired(recordsHome) }))
            return
          }
          if (method !== 'GET') {
            res.statusCode = 405
            res.end('method not allowed')
            return
          }
          res.end(JSON.stringify({ solvers: readDeclarations(recordsHome), restartRequired: restartRequired(recordsHome) }))
        }),
      }))
    }

    // Article generation subsystem (LLM jobs, file writing, compile, browsing).
    disposers.push(registerGenerateEndpoints(ctx as never, {
      home: recordsHome,
      loadRecord: loadGenerationRecord,
    }))

    return () => {
      for (const off of disposers) off()
    }
  }, 'dsh-electro-lab: web')

  try {
    const synced = installPresets()
    if (synced.length > 0) log.info('presets synced', { count: synced.length })
  } catch (error) {
    // A preset that fails to sync must never break the plugin.
    log.warn('preset sync failed', { error })
  }
}
