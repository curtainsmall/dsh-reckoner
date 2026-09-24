/**
 * The record endpoints the panel reads: the list, one record's body, and the
 * delete route. These pin the wire contract the client depends on - the list's
 * `{rows, open, unknownIds, restartRequired}`, the body's identity fields and the
 * trace rows' `content`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearRestartRequired, markRestartRequired, restartRequired } from '../src/state.ts'

interface Route {
  kind: 'exact' | 'prefix'
  path: string
  handler(req: unknown, res: FakeResponse): void | Promise<void>
}

interface FakeResponse {
  statusCode?: number
  headers: Record<string, string>
  body: string
  setHeader(name: string, value: string): void
  end(body: string): void
}

interface IndexBody {
  rows: Array<Record<string, unknown>>
  open: { id: string; title: string; openedAt: number } | null
  unknownIds: string[]
  restartRequired: boolean
}

interface RecordBody {
  id: string
  version: number
  title: string
  openedAt: number
  endedAt: number | null
  rows: Array<Record<string, unknown>>
}

const INDEX = '/api/dsh-reckoner/records-index'
const BODY = '/api/dsh-reckoner/records'
const SETTINGS = '/api/dsh-reckoner/settings'

let home: string
let routes: Route[]
let tools: Array<{ name?: string }>
let published: Record<string, unknown>
let web: typeof import('../src/index.ts')

async function call(route: Route, method: string, url: string, body?: unknown): Promise<{ status: number; json: unknown; text: string }> {
  const res: FakeResponse = {
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(body) {
      this.body = body
    },
  }
  // A body request mimics the node stream the host hands a route: the settings endpoint reads it.
  const req = body === undefined
    ? { method, url }
    : {
        method,
        url,
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(JSON.stringify(body), 'utf8')
        },
      }
  await route.handler(req, res)
  return { status: res.statusCode ?? 200, json: parseJson(res.body), text: res.body }
}

/** The response body as JSON, or undefined when it is not JSON. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function routeFor(path: string): Route {
  const found = routes.find((route) => route.path === path)
  if (found === undefined) throw new Error(`no route registered for ${path}`)
  return found
}

async function index(): Promise<IndexBody> {
  return (await call(routeFor(INDEX), 'GET', INDEX)).json as IndexBody
}

async function body(id: string): Promise<{ status: number; json: RecordBody }> {
  const answer = await call(routeFor(BODY), 'GET', `${BODY}/${id}`)
  return { status: answer.status, json: answer.json as RecordBody }
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'reckoner-web-'))
  process.env['DSH_RECKONER_HOME'] = home
  process.env['DSH_HOME'] = join(home, 'dsh-home')
  process.env['DSH_RECKONER_LOG_LEVEL'] = 'off'
  routes = []
  tools = []
  published = {}
  const dispose = () => {}
  const ctx = {
    effect: (fn: () => (() => void) | void) => {
      const off = fn()
      return typeof off === 'function' ? off : dispose
    },
    tools: { register: (tool: { name?: string }) => { tools.push(tool); return dispose } },
    webServer: { register: (route: Route) => { routes.push(route); return dispose } },
    get: (name: string) => published[name],
    provide: (name: string, value: unknown) => {
      published[name] = value
      return dispose
    },
  }
  web = await import('../src/index.ts')
  // A mount consumes the pending-restart flag: the restart it describes is this one.
  markRestartRequired(home)
  web.apply(ctx as never)

  web.engine.markerStart('What is the current?')
  web.engine.opSet('V_in', { num: 12, dim: 'volt' })
  web.engine.opEval('@V_in/@V_in', 'ratio')
  web.engine.markerMessage('Ohm law', undefined)
  web.engine.markerEnd('I = 2.439 mA')
})

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('the records endpoints', () => {
  it('registers the tool surface, the record routes, the settings route and the generation routes', async () => {
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'eval',
      'get',
      'record_end',
      'record_message',
      'record_start',
      'set',
    ])
    expect(routes.some((route) => route.path === INDEX)).toBe(true)
    expect(routes.some((route) => route.path === BODY)).toBe(true)
    expect(routes.some((route) => route.path === SETTINGS)).toBe(true)
    expect(routes.some((route) => route.path === '/api/dsh-reckoner/generate')).toBe(true)
  })

  it('publishes the lookup seam the search row resolves, and keeps search out of the tool surface', async () => {
    // The host half owns the lookup; the `dsh-reckoner/search` row of the
    // `reckoner-with-search` preset owns the model-facing tool. Mounting the
    // plugin alone must therefore publish the service and register no `search`
    // tool of its own.
    const service = published['reckonerSearch'] as { lookup?: unknown; resolvePolicy?: unknown } | undefined
    expect(typeof service?.lookup).toBe('function')
    expect(typeof service?.resolvePolicy).toBe('function')
    expect(tools.map((tool) => tool.name)).not.toContain('search')
  })

  it('consumes the pending-restart flag at mount and reports the current one on the index', async () => {
    // The flag was marked before apply: this mount is the restart it described.
    expect(restartRequired(home)).toBe(false)
    expect(((await call(routeFor(INDEX), 'GET', INDEX)).json as IndexBody).restartRequired).toBe(false)
    // Marking it is what a writer does; the polled index then reports it as it stands.
    markRestartRequired(home)
    expect(((await call(routeFor(INDEX), 'GET', INDEX)).json as IndexBody).restartRequired).toBe(true)
    clearRestartRequired(home)
  })

  it('serves the settings view and writes it back from a JSON body', async () => {
    const route = routeFor(SETTINGS)
    const before = (await call(route, 'GET', SETTINGS)).json as {
      generation: { latex: { directory: string; compile: boolean }; markdown: { directory: string } }
      search: { defaults: { tier: string }; override: Record<string, unknown>; effective: { maxResults: number } }
      panel: { showAll: boolean }
      restartRequired: boolean
    }
    expect(before.generation.latex).toEqual({ directory: '', language: 'auto', compile: false } as never)
    expect(before.panel.showAll).toBe(false)
    expect(before.restartRequired).toBe(false)

    const written = await call(route, 'PUT', SETTINGS, {
      generation: { format: 'latex', directory: 'D:/tex', language: 'zh-CN', compile: true },
      search: { maxResults: 21, enrich: { pages: 2 } },
      panel: { showAll: true },
    })
    expect(written.status).toBe(200)
    const saved = written.json as { saved: boolean; settings: typeof before }
    expect(saved.saved).toBe(true)
    expect(saved.settings.generation.latex).toMatchObject({ directory: 'D:/tex', language: 'zh-CN', compile: true })
    expect(saved.settings.search.override).toEqual({ maxResults: 21, enrich: { pages: 2 } })
    expect(saved.settings.search.effective.maxResults).toBe(21)
    expect(saved.settings.panel.showAll).toBe(true)
    // the other format was not touched by a latex write
    expect(saved.settings.generation.markdown.directory).toBe('')

    const bad = await call(route, 'PUT', SETTINGS, { generation: { directory: 'D:/x' } })
    expect(bad.status).toBe(400)
    expect(String((bad.json as { error?: string }).error)).toContain('format')

    const wrongMethod = await call(route, 'POST', SETTINGS, {})
    expect(wrongMethod.status).toBe(405)
  })

  it('lists the closed records with the open one apart and the unknown count', async () => {
    const { status, json } = await call(routeFor(INDEX), 'GET', INDEX)
    expect(status).toBe(200)
    expect(Object.keys(json as object).sort()).toEqual(['open', 'restartRequired', 'rows', 'unknownIds'])
    const listing = json as IndexBody
    expect(listing.open).toBeNull()
    expect(listing.unknownIds).toEqual([])
    expect(listing.rows).toHaveLength(1)
    const row = listing.rows[0]!
    expect(Object.keys(row).sort()).toEqual(['endedAt', 'id', 'openedAt', 'title', 'version'])
    expect(typeof row['id']).toBe('string')
    expect(row['title']).toBe('What is the current?')
    expect(row['version']).toBe(1)
    expect(typeof row['openedAt']).toBe('number')
    expect(typeof row['endedAt']).toBe('number')
  })

  it('serves one record body with the trace rows the panel renders', async () => {
    const id = String((await index()).rows[0]?.['id'])
    const { status, json } = await body(id)
    expect(status).toBe(200)
    expect(Object.keys(json).sort()).toEqual(['endedAt', 'id', 'openedAt', 'rows', 'title', 'version'])
    expect(json.id).toBe(id)
    expect(json.version).toBe(1)
    expect(json.title).toBe('What is the current?')
    expect(typeof json.openedAt).toBe('number')
    expect(typeof json.endedAt).toBe('number')
    expect(json.rows.map((row) => row['tool'])).toEqual([
      'record_start',
      'set',
      'eval',
      'record_message',
      'record_end',
    ])
    // The header line is not a trace row, so the first row is seq 1.
    expect(json.rows.map((row) => row['seq'])).toEqual([1, 2, 3, 4, 5])
    for (const row of json.rows) {
      expect(typeof row['seq']).toBe('number')
      expect(typeof row['at']).toBe('number')
      expect(typeof row['ok']).toBe('boolean')
      expect(typeof row['content']).toBe('object')
    }
    expect(json.rows[0]?.['content']).toEqual({ title: 'What is the current?', record: id })
    const stored = json.rows[1]?.['content'] as { name: string; value: unknown }
    expect(stored.name).toBe('V_in')
    expect(stored.value).toEqual({ num: 12, dim: [2, 1, -3, -1, 0, 0, 0] })
    const step = json.rows[2]?.['content'] as { formula: string; target: string; vars: unknown; result: unknown }
    expect(step.formula).toBe('@V_in/@V_in')
    expect(step.target).toBe('ratio')
    expect(step.vars).toEqual({ V_in: { num: 12, dim: [2, 1, -3, -1, 0, 0, 0] } })
    expect(json.rows[4]?.['content']).toEqual({ text: 'I = 2.439 mA', record: id })
  })

  it('serves the open record with endedAt null and keeps it out of the closed rows', async () => {
    web.engine.markerStart('a running record')
    const openId = String(web.engine.openRecordId())
    const listing = await index()
    expect(listing.open).toEqual({ id: openId, title: 'a running record', openedAt: expect.any(Number) })
    expect(listing.rows.some((row) => row['id'] === openId)).toBe(false)

    const served = await body(openId)
    expect(served.status).toBe(200)
    expect(served.json.endedAt).toBeNull()
    expect(served.json.title).toBe('a running record')
    expect(served.json.rows.map((row) => row['tool'])).toEqual(['record_start'])

    web.engine.markerEnd('done')
    const closed = await body(openId)
    expect(typeof closed.json.endedAt).toBe('number')
    expect((await index()).rows.some((row) => row['id'] === openId)).toBe(true)
    // Undo: the later tests count the closed rows.
    await call(routeFor(BODY), 'DELETE', `${BODY}/${openId}`)
  })

  it('counts a record of an unknown version and refuses to serve it', async () => {
    mkdirSync(join(home, 'records'), { recursive: true })
    writeFileSync(
      join(home, 'records', '999.jsonl'),
      [
        JSON.stringify({ seq: 1, at: 1, tool: 'record_start', ok: true, content: { title: 'no header', record: '999' } }),
        JSON.stringify({ seq: 2, at: 2, tool: 'record_end', ok: true, content: { record: '999' } }),
      ].join('\n') + '\n',
      'utf8',
    )

    const listing = await index()
    expect(listing.unknownIds).toHaveLength(1)
    expect(listing.rows.some((row) => row['id'] === '999')).toBe(false)
    expect((await body('999')).status).toBe(404)
  })

  it('answers 404 for an unknown record and 405 for a wrong method', async () => {
    expect((await body('none')).status).toBe(404)
    expect((await call(routeFor(BODY), 'GET', `${BODY}/`)).status).toBe(400)
    expect((await call(routeFor(INDEX), 'POST', INDEX)).status).toBe(405)
  })

  it('deletes a settled record and refuses to delete the open one', async () => {
    const route = routeFor(BODY)
    web.engine.markerStart('a second question')
    const openId = String(web.engine.openRecordId())
    expect((await call(route, 'DELETE', `${BODY}/${openId}`)).status).toBe(409)
    expect((await body(openId)).status).toBe(200)

    const closedId = String(web.engine.listRecords().rows[0]?.id)
    expect((await call(route, 'DELETE', `${BODY}/${closedId}`)).json).toEqual({ deleted: true })
    expect(web.engine.listRecords().rows.some((row) => row['id'] === closedId)).toBe(false)
    expect((await body(closedId)).status).toBe(404)
    expect((await call(route, 'DELETE', `${BODY}/${closedId}`)).status).toBe(404)
    web.engine.markerEnd('done')
  })
})
