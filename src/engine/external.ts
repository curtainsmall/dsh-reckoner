/**
 * External solver transport (envelope protocol): requests are {requestId, args},
 * success is {requestId, result} (void = result: null), failure is
 * {requestId, error: "string"}. Both parameters and results are typed values
 * (SI, rect, no variant/prefix).
 *
 * One transport exists today: http. Typed args travel as a JSON body over a
 * POST — the verb is not a declaration field and is never negotiated. The
 * engine records only the call itself (solver, args, resolved, result) and the
 * interface-level error when one occurs; whether the endpoint's computation
 * succeeded is the endpoint's own business, reported through the envelope's
 * error field.
 */
import { randomUUID } from 'node:crypto'
import { ToolError, ToolErrorCode } from '../errors.ts'
import { log } from '../log.ts'
import { validateValue, type TypedValue } from './values.ts'
import type { ExternalBlock } from './registry.ts'

/** Convert a typed value into its on-the-wire JSON form (canonical shape, no variant/prefix). */
function wireValue(value: TypedValue): unknown {
  return value
}

function readResult(body: unknown, requestId: string): TypedValue | null {
  if (typeof body !== 'object' || body === null) throw new ToolError('the tool response must be a JSON object', ToolErrorCode.ExternalResponse)
  const box = body as { requestId?: unknown; result?: unknown; error?: unknown }
  if (box.requestId !== requestId) {
    throw new ToolError(`response requestId mismatch (got ${String(box.requestId)})`, ToolErrorCode.ExternalResponse)
  }
  if (box.error !== undefined) {
    if (typeof box.error !== 'string') throw new ToolError('the tool response error must be a string', ToolErrorCode.ExternalResponse)
    throw new ToolError(box.error, ToolErrorCode.ExternalError)
  }
  if (!('result' in box)) throw new ToolError('the tool response must contain a result field', ToolErrorCode.ExternalResponse)
  const raw = box.result
  if (raw === null) return null
  const error = validateValue(raw)
  if (error !== undefined) throw new ToolError(`the tool result is not a valid typed value: ${error}`, ToolErrorCode.ExternalResponse)
  return raw as TypedValue
}

/**
 * The message for a transport failure. fetch reports everything it could not do as "fetch failed" and
 * keeps the reason in its cause, so a refused connection, an unknown host and a broken socket all read
 * the same — the caller is left with no way to tell an endpoint that is down from one that is wrong.
 */
function transportFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause: unknown = error.cause
  if (!(cause instanceof Error)) return cause === undefined ? error.message : `${error.message}: ${String(cause)}`
  const code = (cause as { code?: unknown }).code
  const hasCode = typeof code === 'string' && !cause.message.includes(code)
  return `${error.message}: ${hasCode ? `${code} ${cause.message}` : cause.message}`
}

/** Run one external call; return the result from the response (may be null; the engine validates it against the solver signature). */
export async function callExternal(solverId: string, block: ExternalBlock, args: Record<string, TypedValue>): Promise<TypedValue | null> {
  const timeoutMs = block.timeoutMs ?? 30000
  const requestId = randomUUID()
  const startedAt = Date.now()
  const payload = { requestId, args: Object.fromEntries(Object.entries(args).map(([key, value]) => [key, wireValue(value)])) }
  const options = block.transportOptions as { url: string; headers?: Record<string, string> }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    // Typed args travel as a JSON body: POST is the only verb.
    const request: RequestInit = {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
      signal: controller.signal,
      body: JSON.stringify(payload),
    }
    const response = await fetch(options.url, request)
    if (!response.ok) throw new ToolError(`http ${response.status} from ${options.url}`, ToolErrorCode.ExternalHttp)
    const text = await response.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new ToolError(`the tool returned non-JSON: ${text.slice(0, 120)}`, ToolErrorCode.ExternalResponse)
    }
    const result = readResult(parsed, requestId)
    // Transport facts live in the log, never in the record: the trace holds the call itself.
    log.info('external call ok', { solver: solverId, ep: options.url, req: requestId, took_ms: Date.now() - startedAt })
    return result
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError'
    const message = error instanceof ToolError || timedOut ? errorMessage(error) : transportFailure(error)
    log.warn('external call failed', {
      solver: solverId,
      ep: options.url,
      req: requestId,
      took_ms: Date.now() - startedAt,
      code: error instanceof ToolError ? error.code : ToolErrorCode.Tool,
      error: message,
    })
    if (error instanceof ToolError) throw error
    if (timedOut) throw new ToolError(`http request timed out after ${timeoutMs} ms`, ToolErrorCode.ExternalTimeout)
    // A transport failure stays a plain failure (the engine reports it as SOLVER_FAILED), but the reason travels with it.
    throw new Error(message, { cause: error })
  } finally {
    clearTimeout(timer)
  }
}

/** The message of a thrown value, for the log and the receipt. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
