/**
 * External transport: the typed envelope over http, and the failures it can produce.
 *
 * The peer is a local http server in each test, so the protocol is exercised end to end
 * without any declaration archive or engine involved.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { callExternal } from '../../src/engine/external.ts'
import { ToolError, ToolErrorCode } from '../../src/errors.ts'
import { QuantityKind } from '../../src/math/quantity-kind.ts'
import type { ExternalBlock } from '../../src/engine/registry.ts'
import type { TypedValue } from '../../src/engine/values.ts'

const ARGS: Record<string, TypedValue> = { resistance: { type: 'number', value: 100, kind: QuantityKind.Resistance } }

/** One http peer whose reply is decided per test. */
function blockFor(url: string, timeoutMs?: number): ExternalBlock {
  return {
    transport: 'http',
    transportOptions: { url },
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  } as unknown as ExternalBlock
}

let server: Server
let url = ''
let reply: (body: unknown) => { status: number; body: string; contentType?: string }
let seenHeaders: IncomingHttpHeaders = {}

beforeAll(async () => {
  server = createServer((req, res) => {
    seenHeaders = req.headers
    let text = ''
    req.on('data', (chunk) => { text += chunk })
    req.on('end', () => {
      const answer = reply(JSON.parse(text))
      res.statusCode = answer.status
      res.setHeader('content-type', answer.contentType ?? 'application/json')
      res.end(answer.body)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
})

afterAll(() => { server.close() })

const echoResult = (result: TypedValue | null) => (body: unknown) => {
  const envelope = body as { requestId: string }
  return { status: 200, body: JSON.stringify({ requestId: envelope.requestId, result }) }
}

describe('callExternal', () => {
  it('returns the typed result the peer sent', async () => {
    const value: TypedValue = { type: 'complex', value: { re: 5, im: 0 }, kind: QuantityKind.None }
    reply = echoResult(value)
    await expect(callExternal('probe', blockFor(url), ARGS)).resolves.toEqual(value)
  })

  it('sends the args as JSON under the declared headers, and leaves the connection alone', async () => {
    reply = echoResult(null)
    const declared = { transport: 'http', transportOptions: { url, headers: { 'x-probe': 'yes' } } } as unknown as ExternalBlock
    await callExternal('probe', declared, ARGS)
    expect(seenHeaders['content-type']).toBe('application/json')
    expect(seenHeaders['x-probe']).toBe('yes')
    expect(seenHeaders.connection).not.toBe('close')
  })

  it('treats a null result as void', async () => {
    reply = echoResult(null)
    await expect(callExternal('probe', blockFor(url), ARGS)).resolves.toBeNull()
  })

  it('reports the peer error field as its own message', async () => {
    reply = (body) => ({ status: 200, body: JSON.stringify({ requestId: (body as { requestId: string }).requestId, error: 'no solution' }) })
    await expect(callExternal('probe', blockFor(url), ARGS)).rejects.toMatchObject({ code: ToolErrorCode.ExternalError, message: 'no solution' })
  })

  it('lets the error field win over a result in the same response', async () => {
    reply = (body) => ({
      status: 200,
      body: JSON.stringify({ requestId: (body as { requestId: string }).requestId, result: { type: 'number', value: 1, kind: QuantityKind.None }, error: 'both' }),
    })
    await expect(callExternal('probe', blockFor(url), ARGS)).rejects.toMatchObject({ code: ToolErrorCode.ExternalError })
  })

  it('rejects a mismatched requestId, a missing result and non-JSON bodies', async () => {
    reply = () => ({ status: 200, body: JSON.stringify({ requestId: 'someone-else', result: null }) })
    await expect(callExternal('probe', blockFor(url), ARGS)).rejects.toMatchObject({ code: ToolErrorCode.ExternalResponse })

    reply = (body) => ({ status: 200, body: JSON.stringify({ requestId: (body as { requestId: string }).requestId }) })
    await expect(callExternal('probe', blockFor(url), ARGS)).rejects.toMatchObject({ code: ToolErrorCode.ExternalResponse })

    reply = () => ({ status: 200, body: 'not json at all' })
    await expect(callExternal('probe', blockFor(url), ARGS)).rejects.toMatchObject({ code: ToolErrorCode.ExternalResponse })
  })

  it('rejects a non-2xx status and an untouched endpoint', async () => {
    reply = () => ({ status: 500, body: 'boom' })
    await expect(callExternal('probe', blockFor(url), ARGS)).rejects.toMatchObject({ code: ToolErrorCode.ExternalHttp })

    // A port nobody listens on: opened and closed again, so the refusal is a connection refusal. (A
    // well-known port would be refused by fetch itself as a "bad port" before any connection.)
    const gone = createServer()
    await new Promise<void>((resolve) => gone.listen(0, '127.0.0.1', resolve))
    const deadPort = (gone.address() as AddressInfo).port
    await new Promise<void>((resolve) => gone.close(() => resolve()))

    const failure = await callExternal('probe', blockFor(`http://127.0.0.1:${deadPort}/`), ARGS).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as ToolError).code).toBeUndefined()
    // The refusal keeps its reason: "fetch failed" on its own leaves the endpoint undiagnosable.
    expect((failure as Error).message).toMatch(/^fetch failed: .*ECONNREFUSED/)
    expect((failure as Error).message).toContain(`127.0.0.1:${deadPort}`)
  })

  it('gives up on its own timeout', async () => {
    reply = () => ({ status: 200, body: '{}' })
    const slow = createServer(() => { /* never answers */ })
    await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(slow.address() as AddressInfo).port}/`
    await expect(callExternal('probe', blockFor(url, 150), ARGS)).rejects.toMatchObject({ code: ToolErrorCode.ExternalTimeout })
    slow.close()
  })
})
