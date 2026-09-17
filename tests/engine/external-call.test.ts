/**
 * External solvers through the engine: a declaration compiles into a solver, the
 * engine calls the peer over http, and the result lands in the slot — or the call
 * fails with the envelope's own code and leaves the table alone.
 *
 * The peer is a local http server per test, so the whole path runs without a
 * declaration archive or a plugin host.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { Engine } from '../../src/engine/engine.ts'
import { compileExternalSolver } from '../../src/engine/external-solvers.ts'
import { QuantityKind } from '../../src/math/quantity-kind.ts'
import { DeclarationParamType, DeclarationTransport, type ToolDeclaration } from '../../src/tool.ts'

const VOLTAGE = { type: 'complex', value: { re: 90.48, im: 0 }, kind: QuantityKind.Voltage }

type Envelope = { requestId: string; args: Record<string, unknown> }

/** One declaration reaching a peer that computes a voltage from a resistance. */
function declaration(url: string, returns: ToolDeclaration['returns']): ToolDeclaration {
  return {
    name: 'remote_gain',
    description: 'a peer-computed voltage',
    enabled: true,
    parameters: { r: { type: DeclarationParamType.Complex, kind: QuantityKind.Resistance, required: true } },
    returns,
    transport: DeclarationTransport.Http,
    transportOptions: { url },
  }
}

interface Peer {
  url: string
  /** The last envelope the peer received. */
  seen: () => Envelope
}

/** The echo peer's declaration: an object returns holding a string, an array of quantities and a boolean. */
function echoDeclaration(url: string): ToolDeclaration {
  return {
    name: 'echo_http',
    description: 'echoes every parameter back',
    enabled: true,
    parameters: {
      message: { type: DeclarationParamType.String, required: true },
      values: { type: DeclarationParamType.Array, items: { type: DeclarationParamType.Complex, kind: QuantityKind.None } },
      flag: { type: DeclarationParamType.Boolean },
    },
    returns: {
      type: 'object',
      fields: {
        message: { type: 'string' },
        values: { type: 'array', items: { type: 'number', kind: QuantityKind.None } },
        flag: { type: 'boolean' },
      },
    },
    transport: DeclarationTransport.Http,
    transportOptions: { url },
    timeoutMs: 10000,
  }
}

let home = ''
let peer: Server | undefined

afterEach(() => {
  if (home.length > 0) rmSync(home, { recursive: true, force: true })
  home = ''
  peer?.close()
  peer = undefined
})

async function startPeer(answer: (envelope: Envelope) => string): Promise<Peer> {
  let seen: Envelope = { requestId: '', args: {} }
  const server = createServer((req, res) => {
    let text = ''
    req.on('data', (chunk) => { text += chunk })
    req.on('end', () => {
      seen = JSON.parse(text) as Envelope
      res.setHeader('content-type', 'application/json')
      res.end(answer(seen))
    })
  })
  peer = server
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, seen: () => seen }
}

function makeEngine(): Engine {
  home = mkdtempSync(join(tmpdir(), 'elab-external-'))
  const engine = new Engine(home)
  engine.start()
  return engine
}

describe('an external solver through the engine', () => {
  it('calls the peer and lands the result in the slot', async () => {
    const remote = await startPeer((envelope) => JSON.stringify({ requestId: envelope.requestId, result: VOLTAGE }))
    const engine = makeEngine()
    engine.registry.register(compileExternalSolver(declaration(remote.url, { type: 'complex', kind: QuantityKind.Voltage }))!)
    engine.markerQuestion('q')
    engine.opSet('R', { type: 'number', value: 0.1, kind: QuantityKind.Resistance, prefix: 'kilo' })

    const receipt = await engine.opCall('remote_gain', { r: { type: 'slot', value: 'R' } }, 'V')

    expect(receipt).toMatchObject({ ok: true, target: 'V', rev: 1 })
    // The peer sees resolved arguments: canonical shape, SI.
    expect(remote.seen().args.r).toEqual({ type: 'number', value: 100, kind: QuantityKind.Resistance })
    const got = engine.opGet('V') as unknown as { value: { value: { re: number } } }
    expect(got.value.value.re).toBeCloseTo(90.48)
    const row = engine.store.readRows(String(engine.openId())).find((entry) => entry.tool === 'call' && entry.solver === 'remote_gain')
    expect(row?.result).toEqual(VOLTAGE)
    engine.markerAnswer('done')
  })

  it('rejects a peer that answers outside the declared shape, and writes nothing', async () => {
    // A void declaration whose peer answers with a result.
    const answering = await startPeer((envelope) => JSON.stringify({ requestId: envelope.requestId, result: VOLTAGE }))
    const engine = makeEngine()
    engine.registry.register(compileExternalSolver(declaration(answering.url, null))!)
    engine.markerQuestion('q')
    await expect(engine.opCall('remote_gain', { r: { type: 'number', value: 1, kind: QuantityKind.Resistance } }, null))
      .resolves.toMatchObject({ ok: false, code: 'EXTERNAL_RESPONSE' })

    // A valued declaration whose peer answers with null.
    peer?.close()
    const empty = await startPeer((envelope) => JSON.stringify({ requestId: envelope.requestId, result: null }))
    engine.registry.clear()
    engine.registry.register(compileExternalSolver(declaration(empty.url, { type: 'complex', kind: QuantityKind.Voltage }))!)
    await expect(engine.opCall('remote_gain', { r: { type: 'number', value: 1, kind: QuantityKind.Resistance } }, 'V'))
      .resolves.toMatchObject({ ok: false, code: 'EXTERNAL_RESPONSE' })

    // A valued declaration whose peer answers with the wrong type.
    peer?.close()
    const wrong = await startPeer((envelope) => JSON.stringify({ requestId: envelope.requestId, result: { type: 'string', value: 'ninety' } }))
    engine.registry.clear()
    engine.registry.register(compileExternalSolver(declaration(wrong.url, { type: 'complex', kind: QuantityKind.Voltage }))!)
    await expect(engine.opCall('remote_gain', { r: { type: 'number', value: 1, kind: QuantityKind.Resistance } }, 'V'))
      .resolves.toMatchObject({ ok: false, code: 'EXTERNAL_RESPONSE' })
    expect(engine.opGet('V')).toMatchObject({ ok: false })
    engine.markerAnswer('done')
  })

  it('lands an echoed object holding an array of quantities in the slot', async () => {
    const remote = await startPeer((envelope) => JSON.stringify({
      requestId: envelope.requestId,
      result: {
        type: 'object',
        value: {
          message: { type: 'string', value: 'round trip ok' },
          values: { type: 'array', value: [{ type: 'number', value: 1, kind: QuantityKind.None }, { type: 'number', value: 2.5, kind: QuantityKind.None }] },
          flag: { type: 'boolean', value: true },
        },
      },
    }))
    const engine = makeEngine()
    engine.registry.register(compileExternalSolver(echoDeclaration(remote.url))!)
    engine.markerQuestion('q')

    const receipt = await engine.opCall('echo_http', {
      message: { type: 'string', value: 'round trip ok' },
      values: { type: 'array', value: [{ type: 'number', value: 1, kind: QuantityKind.None }, { type: 'number', value: 2.5, kind: QuantityKind.None }] },
      flag: { type: 'boolean', value: true },
    }, 'echo_out')

    expect(receipt).toMatchObject({ ok: true, target: 'echo_out', rev: 1 })
    expect(remote.seen().args).toMatchObject({ message: { type: 'string', value: 'round trip ok' }, flag: { type: 'boolean', value: true } })
    const got = engine.opGet('echo_out') as unknown as { value: { value: { values: { value: unknown[] } } } }
    expect(got.value.value.values.value).toHaveLength(2)
    engine.markerAnswer('done')
  })

  it('reports the peer failure through the receipt', async () => {
    const remote = await startPeer((envelope) => JSON.stringify({ requestId: envelope.requestId, error: 'no solution for these values' }))
    const engine = makeEngine()
    engine.registry.register(compileExternalSolver(declaration(remote.url, { type: 'complex', kind: QuantityKind.Voltage }))!)
    engine.markerQuestion('q')

    await expect(engine.opCall('remote_gain', { r: { type: 'number', value: 1, kind: QuantityKind.Resistance } }, 'V'))
      .resolves.toMatchObject({ ok: false, code: 'EXTERNAL_ERROR', error: 'no solution for these values' })
    expect(engine.opGet('V')).toMatchObject({ ok: false })
    engine.markerAnswer('done')
  })
})
