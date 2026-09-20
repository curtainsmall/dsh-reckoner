#!/usr/bin/env node
/**
 * Reckoner external-solver echo peer — a manual test/demo counterpart.
 *
 * Envelope protocol (typed values): the request carries {requestId, args}
 * where every argument is a typed value; the response is {requestId, result}
 * with a typed value (or result: null for void), or {requestId, error: "…"}
 * for a failed computation. This script echoes the typed args back inside an
 * object result, so a model call can be verified end to end. Node.js standard
 * library only; no build step.
 *
 *     node src/echo.ts http --port 8787     # HTTP server (the only transport)
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A typed value is {type, value, kind?} with type in number/complex/string/boolean/array/object. */
function isTypedValue(value: unknown): boolean {
  return isRecord(value) && typeof value.type === 'string'
}

/** Echo result: every arg as a typed value inside an object value. */
function echoResult(envelope: Record<string, unknown>): Record<string, unknown> {
  const args = envelope.args
  const fields: Record<string, unknown> = {}
  if (isRecord(args)) {
    for (const [key, value] of Object.entries(args)) {
      if (isTypedValue(value)) fields[key] = value
      else fields[key] = { type: 'string', value: JSON.stringify(value) }
    }
  }
  return { type: 'object', value: fields }
}

function respond(res: ServerResponse, payload: Record<string, unknown>): void {
  const body = JSON.stringify(payload)
  res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

function answerEnvelope(res: ServerResponse, envelope: unknown): void {
  if (!isRecord(envelope) || typeof envelope.requestId !== 'string') {
    respond(res, { error: 'envelope must be a JSON object with a requestId field' })
    return
  }
  respond(res, { requestId: envelope.requestId, result: echoResult(envelope) })
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    req.on('end', () => { resolve(Buffer.concat(chunks)) })
  })
}

function serveHttp(host: string, port: number): void {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const body = (await readBody(req)).toString('utf8')
        let envelope: unknown
        try {
          envelope = JSON.parse(body)
        } catch {
          respond(res, { error: 'request body is not JSON' })
          return
        }
        answerEnvelope(res, envelope)
      } catch (error) {
        respond(res, { error: error instanceof Error ? error.message : String(error) })
      }
    })()
  })
  server.listen(port, host, () => {
    console.log(`[http] echo peer listening on http://${host}:${port}/`)
    console.log('[http] {requestId, args: {typed values}} -> {requestId, result: {typed value}}')
  })
}

function usage(): void {
  console.log('Reckoner external-solver echo peer (http transport)')
  console.log('')
  console.log('  node src/echo.ts http [--host 127.0.0.1] [--port 8787]')
  process.exitCode = 1
}

function argValue(argv: string[], flag: string, fallback: string): string {
  const index = argv.indexOf(flag)
  const value = index !== -1 ? argv[index + 1] : undefined
  return value === undefined ? fallback : value
}

const argv = process.argv.slice(2)
const mode = argv[0]

if (mode === 'http') {
  serveHttp(argValue(argv, '--host', '127.0.0.1'), Number(argValue(argv, '--port', '8787')))
} else {
  usage()
}
