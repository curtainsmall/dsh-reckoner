import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EngineErrorCode } from '../src/errors.ts'
import { Engine } from '../src/engine/engine.ts'
import { readSearchFact, SearchErrorCode, SearchOutcome, SearchTier, type SearchSource } from '../src/engine/search.ts'
import { TraceTool } from '../src/engine/trace-tools.ts'
import { resolveSearchConfig, type SearchConfig } from '../src/search/config.ts'
import { hostAllowed, hostOf, originOf } from '../src/search/policy.ts'
import { lookup, type SearchHost, type WebLike } from '../src/search/lookup.ts'
import { SEARCH_PROMPT_VERSION, SEARCH_SYSTEM_PROMPT, buildSearchPrompt } from '../src/search/prompt.ts'
import { parseSynthesisReply } from '../src/search/synthesize.ts'
import { apply as applySearchTool, SEARCH_DESCRIPTION } from '../src/search-tool.ts'

let home: string
let engine: Engine
let clock: number

beforeEach(() => {
  process.env['DSH_RECKONER_LOG_LEVEL'] = 'off'
  home = mkdtempSync(join(tmpdir(), 'reckoner-search-'))
  clock = 1_700_000_000_000
  engine = new Engine(home, { now: () => (clock += 1) })
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

const WIKI: SearchSource = { url: 'https://en.wikipedia.org/wiki/Thermal_conductivity', title: 'Thermal conductivity', snippet: 'Copper conducts 401 W/(m·K).' }
const BLOG: SearchSource = { url: 'https://example-blog.test/copper', title: 'Copper facts', snippet: 'Copper is about 400.' }
const GITHUB: SearchSource = { url: 'https://raw.githubusercontent.com/o/r/main/data.csv', title: 'data.csv' }

const ANSWER_REPLY = JSON.stringify({ answer: 'Copper conducts 401 W/(m·K) at room temperature.', used: [1], insufficient: false })

interface FakeOptions {
  readonly sources?: readonly SearchSource[]
  readonly reply?: string
  readonly llmError?: string
  readonly webError?: string
  readonly noWeb?: boolean
  readonly noLlm?: boolean
  readonly fetchText?: ReadonlyMap<string, string>
  readonly noDefaultRoute?: boolean
}

interface Harness {
  readonly host: SearchHost
  readonly warnings: string[]
  readonly webQueries: Array<{ query: string; maxResults?: number }>
  readonly fetchUrls: string[]
  readonly llmCalls: Array<{ system: string; user: string; provider: string; model: string; maxTokens: number }>
}

/** The host a lookup runs against: the real engine, a fake provider and a fake model. */
function harness(options: FakeOptions = {}): Harness {
  const warnings: string[] = []
  const webQueries: Array<{ query: string; maxResults?: number }> = []
  const fetchUrls: string[] = []
  const llmCalls: Array<{ system: string; user: string; provider: string; model: string; maxTokens: number }> = []
  const web: WebLike = {
    search: async (request) => {
      webQueries.push(request)
      if (options.webError !== undefined) throw new Error(options.webError)
      return { sources: options.sources ?? [WIKI, BLOG], truncated: false }
    },
    fetch: async (request) => {
      fetchUrls.push(request.url)
      const text = options.fetchText?.get(request.url)
      if (text === undefined) throw new Error('ENOTFOUND')
      return { url: request.url, statusCode: 200, body: { kind: 'text', content: text }, truncated: false }
    },
  }
  const llm = {
    stream: (call: { system?: string; messages: Array<{ content: Array<{ text: string }> }>; maxTokens?: number; provider: string; model: string }) => {
      llmCalls.push({
        system: call.system ?? '',
        user: call.messages[0]?.content[0]?.text ?? '',
        provider: call.provider,
        model: call.model,
        maxTokens: call.maxTokens ?? 0,
      })
      const reply = options.reply ?? ANSWER_REPLY
      return (async function* () {
        if (options.llmError !== undefined) {
          yield { type: 'finish', reason: { kind: 'error', failure: { message: options.llmError } } }
          return
        }
        yield { type: 'text-delta', text: reply }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  const services: Record<string, unknown> = {}
  if (options.noWeb !== true) services['web'] = web
  if (options.noLlm !== true) services['llm'] = llm
  if (options.noDefaultRoute !== true) services['agentDefaultModel'] = { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-v4-flash' }) }
  const host: SearchHost = {
    engine,
    get: (name) => services[name],
    warn: (message) => { warnings.push(message) },
  }
  return { host, warnings, webQueries, fetchUrls, llmCalls }
}

function strictConfig(overrides: Partial<SearchConfig> = {}): SearchConfig {
  return { ...resolveSearchConfig({}).config, ...overrides }
}

/** The rows of the open record. */
function openRows() {
  const id = engine.openRecordId()
  if (id === null) throw new Error('no open record')
  const record = engine.readRecordRows(id)
  if (record === null) throw new Error('no rows')
  return record.rows
}

/** The one search row of the open record, as a fact. */
function searchFact() {
  const row = openRows().find((entry) => entry.tool === TraceTool.Search)
  if (row === undefined) throw new Error('no search row')
  return readSearchFact(row.content)
}

describe('the lookup', () => {
  it('answers with the extracted text and hides the retrieval from the model', async () => {
    engine.markerStart('How much heat does copper carry?')
    const fake = harness()
    const receipt = await lookup(fake.host, strictConfig(), { question: 'thermal conductivity of copper at 300 K' })

    expect(receipt.ok).toBe(true)
    expect(receipt.answer).toContain('401')
    expect(receipt.origin).toBe('allowlist')
    // The model gets the answer and nothing else: no URL, no query, no snippet.
    const serialized = JSON.stringify(receipt)
    expect(serialized).not.toContain('http')
    expect(serialized).not.toContain('wikipedia')
    expect(serialized).not.toContain('thermal conductivity of copper')
    expect(Object.keys(receipt).sort()).toEqual(['answer', 'ok', 'origin'])
  })

  it('records the question, the candidates, the allowed sources and the synthesis route', async () => {
    engine.markerStart('Copper')
    const fake = harness()
    await lookup(fake.host, strictConfig(), { question: 'thermal conductivity of copper' })

    const fact = searchFact()
    expect(fact).not.toBeNull()
    expect(fact?.outcome).toBe(SearchOutcome.Answered)
    expect(fact?.tier).toBe(SearchTier.Strict)
    expect(fact?.question).toBe('thermal conductivity of copper')
    // Both candidates are kept - the record shows what the provider found, not only what was allowed.
    expect(fact?.candidates.map((source) => source.url)).toEqual([WIKI.url, BLOG.url])
    expect(fact?.used.map((source) => source.url)).toEqual([WIKI.url])
    expect(fact?.synthesis?.provider).toBe('deepseek')
    expect(fact?.synthesis?.model).toBe('deepseek-v4-flash')
    expect(fact?.synthesis?.promptVersion).toBe(SEARCH_PROMPT_VERSION)
    // The answer relied on material item 1, which the record resolves back to its URL.
    expect(fact?.synthesis?.used).toEqual([0])
    expect(fact?.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('sends the question verbatim and asks the provider for the configured bound', async () => {
    engine.markerStart('Copper')
    const fake = harness()
    await lookup(fake.host, strictConfig({ maxResults: 7 }), { question: 'thermal conductivity of copper' })
    expect(fake.webQueries).toEqual([{ query: 'thermal conductivity of copper', maxResults: 7 }])
  })

  it('refuses a question whose hits are all outside the allowed hosts, and records the attempt', async () => {
    engine.markerStart('Copper')
    const fake = harness({ sources: [BLOG] })
    const receipt = await lookup(fake.host, strictConfig(), { question: 'thermal conductivity of copper' })

    expect(receipt.ok).toBe(false)
    expect(receipt.code).toBe(SearchErrorCode.Insufficient)
    expect(receipt.error).toContain('thermal conductivity of copper')
    expect(fake.llmCalls).toHaveLength(0)
    expect(searchFact()?.outcome).toBe(SearchOutcome.Insufficient)
  })

  it('keeps every source of the open tier', async () => {
    engine.markerStart('Copper')
    const fake = harness({ sources: [WIKI, BLOG] })
    const receipt = await lookup(fake.host, strictConfig({ tier: SearchTier.Open }), { question: 'copper' })
    expect(receipt.ok).toBe(true)
    expect(receipt.origin).toBe('web')
    expect(searchFact()?.used).toHaveLength(2)
  })

  it('answers that nothing was found when the extractive step refuses', async () => {
    engine.markerStart('Copper')
    const fake = harness({
      reply: JSON.stringify({ answer: 'The material states no value at 300 K.', used: [], insufficient: true }),
    })
    const receipt = await lookup(fake.host, strictConfig(), { question: 'thermal conductivity of copper at 300 K' })

    expect(receipt.ok).toBe(false)
    expect(receipt.code).toBe(SearchErrorCode.Insufficient)
    expect(receipt.error).toContain('The material states no value at 300 K.')
    const fact = searchFact()
    expect(fact?.outcome).toBe(SearchOutcome.Insufficient)
    expect(fact?.synthesis?.answer).toContain('no value')
  })

  it('treats an unreadable synthesis reply as a failure and never shows it to the model', async () => {
    engine.markerStart('Copper')
    const fake = harness({ reply: 'Copper is roughly 400 W/(m·K), I am fairly sure.' })
    const receipt = await lookup(fake.host, strictConfig(), { question: 'copper' })

    expect(receipt.ok).toBe(false)
    expect(receipt.code).toBe(SearchErrorCode.Unavailable)
    expect(receipt.error).not.toContain('fairly sure')
    expect(searchFact()?.outcome).toBe(SearchOutcome.Failed)
  })

  it('reports a provider failure without inventing an answer', async () => {
    engine.markerStart('Copper')
    const fake = harness({ webError: 'the search provider is unavailable' })
    const receipt = await lookup(fake.host, strictConfig(), { question: 'copper' })

    expect(receipt.ok).toBe(false)
    expect(receipt.code).toBe(SearchErrorCode.Unavailable)
    expect(receipt.error).toContain('the search provider is unavailable')
    expect(searchFact()?.outcome).toBe(SearchOutcome.Failed)
  })

  it('reports a model failure with the provider detail', async () => {
    engine.markerStart('Copper')
    const fake = harness({ llmError: 'quota exhausted' })
    const receipt = await lookup(fake.host, strictConfig(), { question: 'copper' })
    expect(receipt.ok).toBe(false)
    expect(receipt.error).toContain('quota exhausted')
  })

  it('refuses a lookup the record has no budget for, and records the refusal', async () => {
    engine.markerStart('Copper')
    const fake = harness()
    const config = strictConfig({ maxSearchesPerRecord: 1 })
    expect((await lookup(fake.host, config, { question: 'first' })).ok).toBe(true)

    const receipt = await lookup(fake.host, config, { question: 'second' })
    expect(receipt.ok).toBe(false)
    expect(receipt.code).toBe(SearchErrorCode.BudgetExceeded)
    expect(fake.webQueries).toHaveLength(1)
    const rows = openRows().filter((row) => row.tool === TraceTool.Search)
    expect(rows).toHaveLength(2)
    expect(readSearchFact(rows[1]?.content)?.outcome).toBe(SearchOutcome.Refused)
  })

  it('refuses to look anything up while no record is open', async () => {
    const fake = harness()
    const receipt = await lookup(fake.host, strictConfig(), { question: 'copper' })
    expect(receipt.ok).toBe(false)
    expect(receipt.code).toBe(EngineErrorCode.OpenRecordNotFound)
    expect(fake.webQueries).toHaveLength(0)
  })

  it('reports the two services it cannot work without', async () => {
    engine.markerStart('Copper')
    const noWeb = await lookup(harness({ noWeb: true }).host, strictConfig(), { question: 'copper' })
    expect(noWeb.code).toBe(SearchErrorCode.Unavailable)
    const noLlm = await lookup(harness({ noLlm: true }).host, strictConfig(), { question: 'copper' })
    expect(noLlm.code).toBe(SearchErrorCode.Unavailable)
    const noRoute = await lookup(harness({ noDefaultRoute: true }).host, strictConfig(), { question: 'copper' })
    expect(noRoute.error).toContain('no default model is configured')
  })

  it('pins the synthesis route when the policy names one', async () => {
    engine.markerStart('Copper')
    const fake = harness()
    const config = resolveSearchConfig({ synthesis: { provider: 'openai', model: 'gpt-small' } }).config
    await lookup(fake.host, config, { question: 'copper' })
    expect(fake.llmCalls[0]?.provider).toBe('openai')
    expect(fake.llmCalls[0]?.model).toBe('gpt-small')
  })

  it('fetches the allowed pages for their text when enrich asks for it', async () => {
    engine.markerStart('Copper')
    const fake = harness({ fetchText: new Map([[WIKI.url, 'The measured value is 401 W/(m·K) at 300 K.']]) })
    await lookup(fake.host, strictConfig({ enrich: { pages: 1, charsPerPage: 4000 } }), { question: 'copper' })

    expect(fake.fetchUrls).toEqual([WIKI.url])
    expect(fake.llmCalls[0]?.user).toContain('The measured value is 401')
  })

  it('keeps the retrieval out of the material when enrich is off', async () => {
    engine.markerStart('Copper')
    const fake = harness()
    await lookup(fake.host, strictConfig(), { question: 'copper' })
    expect(fake.fetchUrls).toEqual([])
    expect(fake.llmCalls[0]?.user).toContain('Copper conducts 401 W/(m·K).')
  })

  it('cuts an answer that runs past the policy ceiling', async () => {
    engine.markerStart('Copper')
    const long = 'x'.repeat(400)
    const fake = harness({ reply: JSON.stringify({ answer: long, used: [1], insufficient: false }) })
    const receipt = await lookup(fake.host, strictConfig({ answerMaxChars: 120 }), { question: 'copper' })
    expect(receipt.answer).toHaveLength(121)
    expect(receipt.answer?.endsWith('…')).toBe(true)
    expect(searchFact()?.synthesis?.answer).toHaveLength(121)
  })
})

describe('the extractive prompt', () => {
  it('forbids memory, arithmetic and invention, and asks for the JSON envelope', () => {
    expect(SEARCH_SYSTEM_PROMPT).toContain('Use ONLY the material below')
    expect(SEARCH_SYSTEM_PROMPT).toContain('Never convert a unit, never round, and never compute a derived value')
    expect(SEARCH_SYSTEM_PROMPT).toContain('insufficient')
    expect(SEARCH_SYSTEM_PROMPT).toContain('{"answer": string, "used": number[], "insufficient": boolean}')
  })

  it('numbers the material and keeps the source fields beside it', () => {
    const text = buildSearchPrompt('q', [{ url: WIKI.url, title: 'Thermal conductivity', snippet: 'Copper conducts 401.', publishedAt: '2024-01-02' }])
    expect(text).toContain('[1] Thermal conductivity')
    expect(text).toContain(`url: ${WIKI.url}`)
    expect(text).toContain('published: 2024-01-02')
    expect(text).toContain('Copper conducts 401.')
  })

  it('reads the envelope out of fences and prose, and ignores anything unusable', () => {
    expect(parseSynthesisReply('```json\n{"answer":"a","used":[1],"insufficient":false}\n```', 3)).toEqual({ answer: 'a', used: [0], insufficient: false })
    expect(parseSynthesisReply('Here you go: {"answer":"a","used":[9],"insufficient":false}', 2)).toEqual({ answer: 'a', used: [], insufficient: false })
    expect(parseSynthesisReply('{"answer":"a","used":[1],"insufficient":true}', 2)).toEqual({ answer: 'a', used: [], insufficient: true })
    expect(parseSynthesisReply('no object here', 2)).toBeNull()
    expect(parseSynthesisReply('{"used":[]}', 2)).toBeNull()
  })
})

describe('the search tool row', () => {
  interface RegisteredTool {
    name?: string
    description?: string
    execute: (args: unknown, exec: unknown) => Promise<unknown>
  }

  /** Mount the row against a fake context and hand back what it registered. */
  function mount(options: { service?: unknown; config?: unknown } = {}): { tools: RegisteredTool[]; warnings: string[] } {
    const tools: RegisteredTool[] = []
    const warnings: string[] = []
    const ctx = {
      effect: (fn: () => (() => void) | void) => {
        const off = fn()
        return typeof off === 'function' ? off : () => {}
      },
      tools: { register: (tool: RegisteredTool) => { tools.push(tool); return () => {} } },
      get: (name: string) => (name === 'reckonerSearch' ? options.service : undefined),
      logger: { warn: (message: string) => { warnings.push(message) } },
    }
    applySearchTool(ctx as never, options.config ?? {})
    return { tools, warnings }
  }

  it('registers exactly one tool named search', () => {
    const { tools } = mount()
    expect(tools.map((tool) => tool.name)).toEqual([TraceTool.Search])
  })

  it('forwards the question and its own policy to the host half', async () => {
    const calls: Array<{ question: string; tier: SearchTier }> = []
    const { tools } = mount({
      service: {
        lookup: async (request: { question: string }, config: SearchConfig) => {
          calls.push({ question: request.question, tier: config.tier })
          return { ok: true, answer: 'Copper conducts 401 W/(m*K).', origin: 'allowlist' }
        },
      },
      config: { tier: 'strict', maxSearchesPerRecord: 2 },
    })
    const receipt = await tools[0]!.execute({ question: 'thermal conductivity of copper' }, {})
    expect(receipt).toEqual({ ok: true, answer: 'Copper conducts 401 W/(m*K).', origin: 'allowlist' })
    expect(calls).toEqual([{ question: 'thermal conductivity of copper', tier: SearchTier.Strict }])
  })

  it('names the missing host half instead of throwing', async () => {
    const { tools } = mount()
    const receipt = await tools[0]!.execute({ question: 'copper' }, {})
    expect(receipt).toMatchObject({ ok: false, code: SearchErrorCode.Unavailable })
  })

  it('reports an unusable policy value without failing the row', () => {
    const { tools, warnings } = mount({ config: { tier: 'loose' } })
    expect(tools).toHaveLength(1)
    expect(warnings.join(' ')).toContain('tier must be')
  })

  it('tells the model what the tool is for, and what it must never be used for', () => {
    expect(SEARCH_DESCRIPTION).toContain('the answer is an INPUT, never a result')
    expect(SEARCH_DESCRIPTION).toContain('never ask it to compute, convert, round or derive')
    expect(SEARCH_DESCRIPTION).toContain('say which relation cannot be evaluated and stop')
    // The model is told the sources go to the record, not that it will receive them.
    expect(SEARCH_DESCRIPTION).toContain('they go into the record')
  })
})

describe('the source policy', () => {  it('reads the host of a URL and matches suffixes, never prefixes', () => {
    expect(hostOf('https://en.wikipedia.org/wiki/X')).toBe('en.wikipedia.org')
    expect(hostOf('not a url')).toBeNull()
    expect(hostOf('ftp://example.com/x')).toBeNull()
    expect(hostAllowed('en.wikipedia.org', ['wikipedia.org'])).toBe(true)
    expect(hostAllowed('wikipedia.org', ['wikipedia.org'])).toBe(true)
    expect(hostAllowed('notwikipedia.org', ['wikipedia.org'])).toBe(false)
  })

  it('names the GitHub family on its own', () => {
    expect(originOf([GITHUB], SearchTier.Strict)).toBe('github')
    expect(originOf([WIKI], SearchTier.Strict)).toBe('allowlist')
    expect(originOf([WIKI], SearchTier.Open)).toBe('web')
  })

  it('resolves a policy from a raw config and reports what it replaced', () => {
    const { config, problems } = resolveSearchConfig({ tier: 'loose', allowedHosts: ['*.Example.com', '  '], maxResults: 0, maxSearchesPerRecord: 2.5 })
    expect(config.tier).toBe(SearchTier.Strict)
    expect(config.allowedHosts).toEqual(['example.com'])
    expect(config.maxResults).toBe(12)
    expect(config.maxSearchesPerRecord).toBe(4)
    expect(problems.join(' ')).toContain('tier must be')
  })

  it('keeps an explicitly empty allow-list as a decision', () => {
    const { config } = resolveSearchConfig({ allowedHosts: [] })
    expect(config.allowedHosts).toEqual([])
  })
})
