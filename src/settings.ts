/**
 * The settings surface the Reckoner panel's Settings tab reads and writes.
 *
 * One endpoint pair owns the whole view: `GET /api/dsh-reckoner/settings` returns every subtree with
 * its defaults applied, and `PUT` writes the sections the request names. The shape follows the state
 * file - `generation` (one entry per article format), `search` (defaults / preset / override /
 * effective), `panel`, plus the flat `restartRequired` marker - because the tab is a view of that
 * file, not a second source of truth.
 *
 * Two rules keep the writes honest. A section is written through the state module's own subtree
 * update, so a request can never reach into a subtree it does not name. And a field the request
 * omits keeps its stored value; an explicit `null` clears the override so the layer below applies
 * again, which is how the tab offers "inherit from the preset".
 *
 * Reading a request body is safe here: the harness web server hands a route the raw
 * `node:http` request and the response, with no body parser in between.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ArticleFormat, ArticleLanguage } from './generate.ts'
import { readFormatSettings, writeFormatSettings } from './generate-server.ts'
import { searchPolicyView } from './search/effective.ts'
import { readSection, restartRequired, updateSection, type SearchPolicyOverride } from './state.ts'

/** The one settings endpoint; the method selects read or write. */
export const SETTINGS_PATH = '/api/dsh-reckoner/settings'

/** Largest settings body accepted: the whole tree is a few hundred bytes. */
const BODY_LIMIT = 64 * 1024

/** The two formats the settings view carries, keyed the way the response spells them. */
const FORMATS: readonly ArticleFormat[] = [ArticleFormat.Markdown, ArticleFormat.Latex]

function isBag(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read a JSON request body; anything unparsable or oversized reads as undefined. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (typeof (req as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] !== 'function') return undefined
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    size += buffer.length
    if (size > BODY_LIMIT) return undefined
    chunks.push(buffer)
  }
  if (size === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    return undefined
  }
}

/** Everything the Settings tab shows, defaults applied. */
export function settingsView(home: string): Record<string, unknown> {
  const generation: Record<string, unknown> = {}
  for (const format of FORMATS) {
    const settings = readFormatSettings(home, format)
    generation[format] = {
      directory: settings.directory,
      language: settings.language,
      ...(format === ArticleFormat.Latex ? { compile: settings.compile } : {}),
    }
  }
  const policy = searchPolicyView(home)
  return {
    generation,
    search: {
      defaults: policy.defaults,
      preset: policy.preset,
      override: policy.override,
      effective: policy.effective,
    },
    panel: { showAll: readSection(home, 'panel').showAll === true },
    restartRequired: restartRequired(home),
    // The languages the host accepts, so a surface offers the vocabulary instead of inventing it.
    languages: SETTINGS_LANGUAGES,
  }
}

/** One article format named by a request, or undefined when the name is not one of ours. */
function readFormat(input: unknown): ArticleFormat | undefined {
  if (input === ArticleFormat.Markdown || input === ArticleFormat.Latex) return input
  return undefined
}

/** Apply one `generation` section: `{ format, directory?, language?, compile? }`. */
function writeGeneration(home: string, input: unknown): string | undefined {
  if (!isBag(input)) return 'generation must be an object'
  const format = readFormat(input['format'])
  if (format === undefined) return 'generation needs format "markdown" or "latex"'
  const values: { directory?: string; language?: string; compile?: boolean } = {}
  if (typeof input['directory'] === 'string') values.directory = input['directory']
  if (typeof input['language'] === 'string') values.language = input['language']
  if (typeof input['compile'] === 'boolean') values.compile = input['compile']
  writeFormatSettings(home, format, values)
  return undefined
}

/** Apply one `search` section: each named field lands in the override, `null` removes it. */
function writeSearch(home: string, input: unknown): string | undefined {
  if (input === null) {
    updateSection(home, 'search', (override) => {
      for (const key of Object.keys(override)) delete (override as Record<string, unknown>)[key]
    })
    return undefined
  }
  if (!isBag(input)) return 'search must be an object or null'
  updateSection(home, 'search', (override) => {
    const bag = override as Record<string, unknown>
    for (const [key, value] of Object.entries(input)) {
      if (value === null) {
        delete bag[key]
        continue
      }
      // Nested layers (enrich, synthesis) merge field by field so naming one keeps the other.
      if ((key === 'enrich' || key === 'synthesis') && isBag(value)) {
        const merged = isBag(bag[key]) ? { ...(bag[key] as Record<string, unknown>) } : {}
        for (const [field, fieldValue] of Object.entries(value)) {
          if (fieldValue === null) delete merged[field]
          else merged[field] = fieldValue
        }
        if (Object.keys(merged).length === 0) delete bag[key]
        else bag[key] = merged
        continue
      }
      bag[key] = value
    }
  })
  return undefined
}

/** Apply one `panel` section: `{ showAll?: boolean }`. */
function writePanel(home: string, input: unknown): string | undefined {
  if (!isBag(input)) return 'panel must be an object'
  const showAll = input['showAll']
  if (showAll !== undefined && typeof showAll !== 'boolean') return 'panel.showAll must be a boolean'
  updateSection(home, 'panel', (panel) => {
    if (showAll === undefined || showAll === false) delete panel.showAll
    else panel.showAll = true
  })
  return undefined
}

/** Apply a settings body; returns the first problem it found, or undefined when everything was written. */
export function applySettings(home: string, body: unknown): string | undefined {
  if (!isBag(body)) return 'the settings body must be an object'
  const generation = body['generation']
  if (generation !== undefined) {
    const problem = writeGeneration(home, generation)
    if (problem !== undefined) return problem
  }
  if (body['search'] !== undefined) {
    const problem = writeSearch(home, body['search'])
    if (problem !== undefined) return problem
  }
  if (body['panel'] !== undefined) {
    const problem = writePanel(home, body['panel'])
    if (problem !== undefined) return problem
  }
  return undefined
}

/** The known languages, for a client that wants to offer them instead of hard-coding them. */
export const SETTINGS_LANGUAGES: readonly ArticleLanguage[] = [ArticleLanguage.Auto, ArticleLanguage.ZhCN, ArticleLanguage.En]

/**
 * Register the settings route.
 * @param webServer - the route registry of the host web server.
 * @param home - the plugin home whose state file is read and written.
 * @returns the disposer that removes the route.
 */
export function registerSettingsEndpoint(
  webServer: { register(route: { kind: 'exact'; path: string; handler(req: IncomingMessage, res: ServerResponse): void | Promise<void> }): () => void },
  home: string,
): () => void {
  return webServer.register({
    kind: 'exact',
    path: SETTINGS_PATH,
    handler: async (req, res) => {
      const method = req.method ?? 'GET'
      const send = (status: number, payload: unknown): void => {
        res.statusCode = status
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(payload))
      }
      if (method === 'GET') {
        send(200, settingsView(home))
        return
      }
      if (method !== 'PUT') {
        res.statusCode = 405
        res.end('method not allowed')
        return
      }
      const body = await readJsonBody(req)
      const problem = applySettings(home, body)
      if (problem !== undefined) {
        send(400, { error: problem })
        return
      }
      send(200, { saved: true, settings: settingsView(home) })
    },
  })
}

/** The search override a write may carry, exported for the settings tests. */
export type { SearchPolicyOverride }
