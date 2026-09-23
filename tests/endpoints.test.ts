/**
 * The record endpoints the panel reads: the list, one record's body, and the
 * delete route. These pin the wire contract the client depends on - the list's
 * `{rows, open, unknown}`, the body's identity fields and the trace rows'
 * `content`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
  unknown: number
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

let home: string
let routes: Route[]
let tools: Array<{ name?: string }>
let web: typeof import('../src/index.ts')

function call(route: Route, method: string, url: string): { status: number; json: unknown; text: string } {
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
  route.handler({ method, url }, res)
  let json: unknown
  try {
    json = JSON.parse(res.body)
  } catch {
    json = undefined
  }
  return { status: res.statusCode ?? 200, json, text: res.body }
}

function routeFor(path: string): Route {
  const found = routes.find((route) => route.path === path)
  if (found === undefined) throw new Error(`no route registered for ${path}`)
  return found
}

function index(): IndexBody {
  return call(routeFor(INDEX), 'GET', INDEX).json as IndexBody
}

function body(id: string): { status: number; json: RecordBody } {
  const answer = call(routeFor(BODY), 'GET', `${BODY}/${id}`)
  return { status: answer.status, json: answer.json as RecordBody }
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'reckoner-web-'))
  process.env['DSH_RECKONER_HOME'] = home
  process.env['DSH_HOME'] = join(home, 'dsh-home')
  process.env['DSH_RECKONER_LOG_LEVEL'] = 'off'
  routes = []
  tools = []
  const dispose = () => {}
  const ctx = {
    effect: (fn: () => (() => void) | void) => {
      const off = fn()
      return typeof off === 'function' ? off : dispose
    },
    tools: { register: (tool: { name?: string }) => { tools.push(tool); return dispose } },
    webServer: { register: (route: Route) => { routes.push(route); return dispose } },
    get: () => undefined,
  }
  web = await import('../src/index.ts')
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
  it('registers the tool surface, the record routes and the generation routes', () => {
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
    expect(routes.some((route) => route.path === '/api/dsh-reckoner/generate')).toBe(true)
  })

  it('lists the closed records with the open one apart and the unknown count', () => {
    const { status, json } = call(routeFor(INDEX), 'GET', INDEX)
    expect(status).toBe(200)
    expect(Object.keys(json as object).sort()).toEqual(['open', 'rows', 'unknown'])
    const listing = json as IndexBody
    expect(listing.open).toBeNull()
    expect(listing.unknown).toBe(0)
    expect(listing.rows).toHaveLength(1)
    const row = listing.rows[0]!
    expect(Object.keys(row).sort()).toEqual(['endedAt', 'id', 'openedAt', 'title', 'version'])
    expect(typeof row['id']).toBe('string')
    expect(row['title']).toBe('What is the current?')
    expect(row['version']).toBe(1)
    expect(typeof row['openedAt']).toBe('number')
    expect(typeof row['endedAt']).toBe('number')
  })

  it('serves one record body with the trace rows the panel renders', () => {
    const id = String(index().rows[0]?.['id'])
    const { status, json } = body(id)
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

  it('serves the open record with endedAt null and keeps it out of the closed rows', () => {
    web.engine.markerStart('a running record')
    const openId = String(web.engine.openRecordId())
    const listing = index()
    expect(listing.open).toEqual({ id: openId, title: 'a running record', openedAt: expect.any(Number) })
    expect(listing.rows.some((row) => row['id'] === openId)).toBe(false)

    const served = body(openId)
    expect(served.status).toBe(200)
    expect(served.json.endedAt).toBeNull()
    expect(served.json.title).toBe('a running record')
    expect(served.json.rows.map((row) => row['tool'])).toEqual(['record_start'])

    web.engine.markerEnd('done')
    const closed = body(openId)
    expect(typeof closed.json.endedAt).toBe('number')
    expect(index().rows.some((row) => row['id'] === openId)).toBe(true)
    // Undo: the later tests count the closed rows.
    call(routeFor(BODY), 'DELETE', `${BODY}/${openId}`)
  })

  it('counts a record of an unknown version and refuses to serve it', () => {
    mkdirSync(join(home, 'records'), { recursive: true })
    writeFileSync(
      join(home, 'records', '999.jsonl'),
      [
        JSON.stringify({ seq: 1, at: 1, tool: 'record_start', ok: true, content: { title: 'no header', record: '999' } }),
        JSON.stringify({ seq: 2, at: 2, tool: 'record_end', ok: true, content: { record: '999' } }),
      ].join('\n') + '\n',
      'utf8',
    )

    const listing = index()
    expect(listing.unknown).toBe(1)
    expect(listing.rows.some((row) => row['id'] === '999')).toBe(false)
    expect(body('999').status).toBe(404)
  })

  it('answers 404 for an unknown record and 405 for a wrong method', () => {
    expect(body('none').status).toBe(404)
    expect(call(routeFor(BODY), 'GET', `${BODY}/`).status).toBe(400)
    expect(call(routeFor(INDEX), 'POST', INDEX).status).toBe(405)
  })

  it('deletes a settled record and refuses to delete the open one', () => {
    const route = routeFor(BODY)
    web.engine.markerStart('a second question')
    const openId = String(web.engine.openRecordId())
    expect(call(route, 'DELETE', `${BODY}/${openId}`).status).toBe(409)
    expect(body(openId).status).toBe(200)

    const closedId = String(web.engine.listRecords().rows[0]?.id)
    expect(call(route, 'DELETE', `${BODY}/${closedId}`).json).toEqual({ deleted: true })
    expect(web.engine.listRecords().rows.some((row) => row['id'] === closedId)).toBe(false)
    expect(body(closedId).status).toBe(404)
    expect(call(route, 'DELETE', `${BODY}/${closedId}`).status).toBe(404)
    web.engine.markerEnd('done')
  })
})
