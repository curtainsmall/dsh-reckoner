/**
 * The record endpoints the panel reads: the list, one record's body, and the
 * delete route. These pin the wire contract the client depends on - the index
 * row's `answeredAt` and the trace row's `content`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
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

  web.engine.markerQuestion('What is the current?')
  web.engine.opSet('V_in', { num: 12, dim: 'volt' })
  web.engine.opEval('@V_in/@V_in', 'ratio')
  web.engine.markerAnalyse('Ohm law')
  web.engine.markerAnswer('I = 2.439 mA')
})

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('the records endpoints', () => {
  it('registers the tool surface, the record routes and the generation routes', () => {
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'eval',
      'get',
      'record_analyse',
      'record_answer',
      'record_question',
      'set',
    ])
    expect(routes.some((route) => route.path === '/api/dsh-reckoner/records-index')).toBe(true)
    expect(routes.some((route) => route.path === '/api/dsh-reckoner/records')).toBe(true)
    expect(routes.some((route) => route.path === '/api/dsh-reckoner/generate')).toBe(true)
  })

  it('lists the index rows with the answered span', () => {
    const { status, json } = call(routeFor('/api/dsh-reckoner/records-index'), 'GET', '/api/dsh-reckoner/records-index')
    expect(status).toBe(200)
    const rows = (json as { rows: Array<Record<string, unknown>> }).rows
    expect(rows).toHaveLength(1)
    expect(typeof rows[0]?.['id']).toBe('string')
    expect(rows[0]?.['question']).toBe('What is the current?')
    expect(typeof rows[0]?.['openedAt']).toBe('number')
    expect(typeof rows[0]?.['answeredAt']).toBe('number')
  })

  it('serves one record body with the trace rows the panel renders', () => {
    const id = String(web.engine.indexRows()[0]?.id)
    const { status, json } = call(routeFor('/api/dsh-reckoner/records'), 'GET', `/api/dsh-reckoner/records/${id}`)
    expect(status).toBe(200)
    const body = json as { id: string; question: string; answeredAt: number | null; rows: Array<Record<string, unknown>> }
    expect(body.id).toBe(id)
    expect(body.question).toBe('What is the current?')
    expect(body.answeredAt).not.toBeNull()
    expect(body.rows.map((row) => row['tool'])).toEqual([
      'record_question',
      'set',
      'eval',
      'record_analyse',
      'record_answer',
    ])
    for (const row of body.rows) {
      expect(typeof row['seq']).toBe('number')
      expect(typeof row['at']).toBe('number')
      expect(typeof row['ok']).toBe('boolean')
      expect(typeof row['content']).toBe('object')
    }
    const stored = body.rows[1]?.['content'] as { name: string; value: unknown }
    expect(stored.name).toBe('V_in')
    expect(stored.value).toEqual({ num: 12, dim: [2, 1, -3, -1, 0, 0, 0] })
    const step = body.rows[2]?.['content'] as { formula: string; target: string; vars: unknown; result: unknown }
    expect(step.formula).toBe('@V_in/@V_in')
    expect(step.target).toBe('ratio')
    expect(step.vars).toEqual({ V_in: { num: 12, dim: [2, 1, -3, -1, 0, 0, 0] } })
  })

  it('answers 404 for an unknown record and 405 for a wrong method', () => {
    expect(call(routeFor('/api/dsh-reckoner/records'), 'GET', '/api/dsh-reckoner/records/none').status).toBe(404)
    expect(call(routeFor('/api/dsh-reckoner/records-index'), 'POST', '/api/dsh-reckoner/records-index').status).toBe(405)
  })

  it('deletes a settled record and refuses to delete the open one', () => {
    const route = routeFor('/api/dsh-reckoner/records')
    web.engine.markerQuestion('a second question')
    const openId = String(web.engine.openRecordId())
    expect(call(route, 'DELETE', `/api/dsh-reckoner/records/${openId}`).status).toBe(409)

    const closedId = String(web.engine.indexRows().find((row) => row.id !== openId)?.id)
    expect(call(route, 'DELETE', `/api/dsh-reckoner/records/${closedId}`).json).toEqual({ deleted: true })
    expect(web.engine.indexRows().some((row) => row.id === closedId)).toBe(false)
    expect(call(route, 'GET', `/api/dsh-reckoner/records/${closedId}`).status).toBe(404)
    web.engine.markerAnswer('done')
  })
})
