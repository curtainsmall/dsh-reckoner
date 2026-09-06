/**
 * Host article generation subsystem: LLM article jobs, file writing, optional
 * PDF compilation (pandoc/xelatex), OS reveal/open, host-driven directory
 * browsing and the remembered generation settings. Ported from the v0.9.0
 * generation feature and wired to the engine record store through the
 * `loadRecord` dependency — this module has no Cordis imports; `register`
 * takes the services it needs (web server, optional llm/agentDefaultModel).
 */
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import {
  ArticleFormat,
  ArticleLanguage,
  GenerationPhase,
  TemplateLanguage,
  buildArticlePrompt,
  buildLatexDocument,
  normalizeFileName,
  resolveTemplateLanguage,
  templateLanguageToArticleLanguage,
  type Record,
} from './generate.ts'

/** Minimal structural shape of the web-server route registry. */
export interface WebServerLike {
  register(route: {
    kind: 'exact'
    path: string
    handler(req: unknown, res: {
      statusCode?: number
      setHeader(name: string, value: string): void
      end(body: string): void
    }): void | Promise<void>
  }): () => void
}

/** Minimal request shape the endpoints read (method + url for query parsing). */
export interface RequestLike {
  method?: string
  url?: string
}

/** Services the generation endpoints need: webServer plus optional llm runtime/default model. */
export interface GenerateContext {
  webServer: WebServerLike
  get?(name: string): unknown
  logger?: { warn(...parts: unknown[]): void }
}

/** How the host resolves one record for generation (engine store → Record facts). */
export interface GenerateDeps {
  home: string
  loadRecord(id: string): Record | undefined
}

/** Optional host LLM runtime shape (dsh-llm; absent → generation refuses with a clear error). */
interface LlmLike {
  stream(options: {
    provider: string
    model: string
    messages: Array<{ role: string; content: Array<{ type: string; text: string }> }>
    system?: string
    maxTokens?: number
    signal?: AbortSignal
  }): AsyncIterable<unknown>
}

/** Optional deployment default-model selection (dsh-agent-default-model). */
interface AgentDefaultModelLike {
  currentSelection(): { provider: string; model: string; reasoningEffort?: string }
}

/** The web paths of the generation subsystem (shared wire contract host ↔ client). */
export const GENERATE_PATH = '/api/dsh-electro-lab/generate'
export const GENERATE_PROGRESS_PATH = '/api/dsh-electro-lab/generate-progress'
export const GENERATE_CANCEL_PATH = '/api/dsh-electro-lab/generate-cancel'
export const REVEAL_PATH = '/api/dsh-electro-lab/reveal'
export const LIST_DIRS_PATH = '/api/dsh-electro-lab/list-dirs'
export const LIST_ROOTS_PATH = '/api/dsh-electro-lab/list-roots'
export const DIRECTORY_TREE_CSS_PATH = '/api/dsh-electro-lab/directory-tree.css'
export const GENERATE_DIR_PATH = '/api/dsh-electro-lab/generate-dir'

/** Non-config serialized state lives in one JSON file under the records home. */
const STATE_FILE = 'state.json'
/** Legacy plain-text location of the remembered directory (migrated on read). */
const LEGACY_GENERATE_DIR_FILE = 'generate-dir.txt'

/** Remembered generation state: output directory, article language, format and PDF-compile toggle. */
interface GenerateState {
  generateDir?: string
  generateLanguage?: string
  generateFormat?: string
  generateCompile?: boolean
}

/** Raw state.json contents (never throws — missing or corrupt file reads as {}). */
function readStoredState(home: string): Partial<GenerateState> {
  try {
    const parsed = JSON.parse(readFileSync(join(home, STATE_FILE), 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Partial<GenerateState>) : {}
  } catch {
    return {}
  }
}

/** Membership guards for query-string enum values. */
function isArticleFormat(value: unknown): value is ArticleFormat {
  return value === ArticleFormat.Markdown || value === ArticleFormat.Latex
}

function isArticleLanguage(value: unknown): value is ArticleLanguage {
  return value === ArticleLanguage.Auto || value === ArticleLanguage.ZhCN || value === ArticleLanguage.En
}

/** The remembered generation state, with a one-time migration from the legacy plain-text file. */
function readGenerateState(home: string): GenerateState {
  const stored = readStoredState(home)
  const state: GenerateState = {
    generateDir: typeof stored.generateDir === 'string' && stored.generateDir.trim().length > 0 ? stored.generateDir.trim() : undefined,
    generateLanguage: typeof stored.generateLanguage === 'string' && stored.generateLanguage.length > 0 ? stored.generateLanguage : undefined,
    generateFormat: isArticleFormat(stored.generateFormat) ? stored.generateFormat : undefined,
    generateCompile: typeof stored.generateCompile === 'boolean' ? stored.generateCompile : undefined,
  }
  if (state.generateDir === undefined) {
    try {
      const legacy = readFileSync(join(home, LEGACY_GENERATE_DIR_FILE), 'utf8').trim()
      if (legacy.length > 0) state.generateDir = legacy
    } catch {
      // no legacy file — nothing to migrate
    }
  }
  return state
}

/** Persist the generation state; undefined fields keep their stored values. */
function writeGenerateState(home: string, state: GenerateState): void {
  mkdirSync(home, { recursive: true })
  const merged: Partial<GenerateState> = { ...readStoredState(home), ...state }
  if (merged.generateDir === undefined || merged.generateDir.trim().length === 0) delete merged.generateDir
  if (merged.generateLanguage === undefined || merged.generateLanguage.length === 0) delete merged.generateLanguage
  if (merged.generateFormat === undefined || !isArticleFormat(merged.generateFormat)) delete merged.generateFormat
  if (merged.generateCompile === undefined || typeof merged.generateCompile !== 'boolean') delete merged.generateCompile
  writeFileSync(join(home, STATE_FILE), JSON.stringify(merged), 'utf8')
  try {
    rmSync(join(home, LEGACY_GENERATE_DIR_FILE), { force: true })
  } catch {
    // best effort
  }
}

/** Existing drive roots on Windows (empty elsewhere). */
function listDriveRoots(): string[] {
  if (process.platform !== 'win32') return []
  const roots: string[] = []
  for (let code = 65; code <= 90; code++) {
    const root = `${String.fromCharCode(code)}:\\`
    try {
      if (existsSync(root)) roots.push(root)
    } catch {
      // skip unreadable drives
    }
  }
  return roots
}

/** List one directory: its absolute path, parent, sorted subdirectory and file names, plus drive roots. */
function listDirectories(inputPath: string): { path: string; parent: string; entries: string[]; files: string[]; roots: string[] } {
  const requested = inputPath.trim()
  const resolved = requested.length > 0 && existsSync(requested) && statSync(requested).isDirectory()
    ? requested
    : homedir()
  const names = readdirSync(resolved, { withFileTypes: true })
  const entries = names.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort((a, b) => a.localeCompare(b))
  const files = names.filter((entry) => entry.isFile()).map((entry) => entry.name).sort((a, b) => a.localeCompare(b))
  const parent = join(resolved, '..')
  return { path: resolved, parent, entries, files, roots: parent === resolved ? listDriveRoots() : [] }
}

/** The vendored directory-tree stylesheet (MIT, from @aiquants/directory-tree's standalone build). */
function readDirectoryTreeCss(): string {
  try {
    return readFileSync(new URL('../assets/directory-tree.css', import.meta.url), 'utf8')
  } catch {
    return ''
  }
}

/* ── OS launch (open / reveal) ─────────────────────────────────────────────── */

interface OpenRecipe {
  commands: string[]
  args: (target: string, mode: 'open' | 'reveal', isDir: boolean) => string[]
}

function openRecipe(): OpenRecipe {
  switch (process.platform) {
    case 'darwin':
      return {
        commands: ['/usr/bin/open'],
        args: (target, mode, isDir) => mode === 'open' || isDir ? [target] : ['-R', target],
      }
    case 'win32':
      return {
        commands: ['explorer.exe'],
        args: (target, mode, isDir) => mode === 'open' ? [target] : [isDir ? target : `/select,${target}`],
      }
    default:
      return {
        commands: ['xdg-open', '/usr/bin/xdg-open'],
        args: (target, mode, isDir) => [mode === 'open' || isDir ? target : dirname(target)],
      }
  }
}

function spawnDetached(command: string, args: string[]): Promise<{ ok: boolean; code?: string; message: string }> {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { detached: true })
      const timer = setTimeout(() => resolve({ ok: true, message: 'ok' }), 10_000)
      child.once('spawn', () => {
        clearTimeout(timer)
        resolve({ ok: true, message: 'ok' })
      })
      child.once('error', (error) => {
        clearTimeout(timer)
        resolve({ ok: false, code: (error as NodeJS.ErrnoException).code, message: error.message })
      })
      child.unref()
    } catch (error) {
      resolve({ ok: false, code: 'THROW', message: error instanceof Error ? error.message : String(error) })
    }
  })
}

async function launchInOs(target: string, mode: 'open' | 'reveal'): Promise<string> {
  if (!existsSync(target)) return `failed: no such file or directory: ${target}`
  const isDir = statSync(target).isDirectory()
  const recipe = openRecipe()
  const args = recipe.args(target, mode, isDir)
  for (const command of recipe.commands) {
    const outcome = await spawnDetached(command, args)
    if (outcome.ok) return 'ok'
    if (outcome.code !== 'ENOENT') return `failed: ${outcome.message}`
  }
  return 'failed: no suitable opener found'
}

/* ── Generation jobs ───────────────────────────────────────────────────────── */

/**
 * Generate the solution article for one record through the host LLM. For
 * Markdown the model's text IS the article; for LaTeX the model writes only
 * the body, which is sanitized and wrapped in the document shell here.
 */
async function generateArticle(
  ctx: GenerateContext,
  record: Record,
  signal: AbortSignal,
  language: ArticleLanguage,
  format: ArticleFormat,
  onProgress?: (percent: number) => void,
): Promise<string> {
  const llm = ctx.get?.('llm') as LlmLike | undefined
  if (llm === undefined) throw new Error('the LLM service is unavailable in this deployment')
  const defaults = ctx.get?.('agentDefaultModel') as AgentDefaultModelLike | undefined
  const route = defaults?.currentSelection()
  if (route === undefined || route.provider === undefined || route.model === undefined) {
    throw new Error('no default model is configured — pick one in Settings first')
  }
  // LaTeX needs the document class fixed BEFORE generation: resolve the
  // template language (auto → probe the question text) and pin the prompt to it.
  let templateLanguage: TemplateLanguage | undefined
  switch (format) {
    case ArticleFormat.Latex:
      templateLanguage = resolveTemplateLanguage(language, record.question)
      break
    case ArticleFormat.Markdown:
      break
  }
  const promptLanguage: ArticleLanguage = templateLanguage === undefined
    ? language
    : templateLanguageToArticleLanguage(templateLanguage)
  const { system, user } = buildArticlePrompt(record, promptLanguage, format)
  const startedAt = Date.now()
  let text = ''
  for await (const raw of llm.stream({
    provider: route.provider,
    model: route.model,
    messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    system,
    maxTokens: 4096,
    signal,
  })) {
    const chunk = raw as { type?: string; text?: string; reason?: string }
    if (chunk.type === 'text-delta') {
      text += chunk.text ?? ''
    } else if (chunk.type === 'tool-call-delta') {
      throw new Error('the generation model unexpectedly requested a tool')
    } else if (chunk.type === 'finish' && chunk.reason === 'aborted') {
      throw new Error('article generation was aborted')
    }
    if (onProgress !== undefined) {
      onProgress(Math.min(90, 10 + ((Date.now() - startedAt) / 30_000) * 80))
    }
  }
  const trimmed = text.trim()
  if (trimmed.length === 0) throw new Error('the model produced no article text')
  if (templateLanguage === undefined) return trimmed
  const document = buildLatexDocument(trimmed, templateLanguage)
  if (!document.ok) throw new Error(`LaTeX validation failed: ${document.error}`)
  return document.text
}

/** One in-memory generation job (never persisted — no generation log). */
interface GenerateJob {
  status: 'running' | 'done' | 'error'
  percent: number
  phase: GenerationPhase
  path?: string
  pdfPath?: string
  compileError?: string
  error?: string
  abort: () => void
}

const generateJobs = new Map<string, GenerateJob>()

/** Run one command and collect its output tail; kills on timeout. */
function runCommand(command: string, args: string[], cwd: string, timeoutMs: number): Promise<{ ok: boolean; code: number | null; output: string }> {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { cwd })
      let output = ''
      const timer = setTimeout(() => { child.kill() }, timeoutMs)
      child.stdout?.on('data', (chunk: Buffer) => { output += String(chunk) })
      child.stderr?.on('data', (chunk: Buffer) => { output += String(chunk) })
      child.on('error', (error) => {
        clearTimeout(timer)
        resolve({ ok: false, code: null, output: error.message })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ ok: code === 0, code, output: output.slice(-4000) })
      })
    } catch (error) {
      resolve({ ok: false, code: null, output: error instanceof Error ? error.message : String(error) })
    }
  })
}

/** Candidate xelatex commands: PATH first, then known MiKTeX install locations on Windows. */
function xelatexCandidates(): string[] {
  const candidates = ['xelatex']
  if (process.platform === 'win32') {
    for (const root of listDriveRoots()) {
      candidates.push(join(root, 'MiKTeX', 'miktex', 'bin', 'x64', 'xelatex.exe'))
    }
    const local = process.env.LOCALAPPDATA
    if (local !== undefined) candidates.push(join(local, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64', 'xelatex.exe'))
    candidates.push('C:\\Program Files\\MiKTeX\\miktex\\bin\\x64\\xelatex.exe')
    candidates.push('C:\\Program Files (x86)\\MiKTeX\\miktex\\bin\\x64\\xelatex.exe')
  }
  return candidates
}

/** Candidate pandoc commands: PATH first, then the usual Windows install location. */
function pandocCandidates(): string[] {
  const candidates = ['pandoc']
  if (process.platform === 'win32') {
    candidates.push('C:\\Program Files\\Pandoc\\pandoc.exe')
    const local = process.env.LOCALAPPDATA
    if (local !== undefined) candidates.push(join(local, 'Pandoc', 'pandoc.exe'))
  }
  return candidates
}

/** The CJK fallback font pandoc passes to xelatex for Chinese Markdown articles (per-OS default). */
function cjkMainFont(): string {
  switch (process.platform) {
    case 'darwin': return 'PingFang SC'
    case 'win32': return 'Microsoft YaHei'
    default: return 'Noto Sans CJK SC'
  }
}

/** Compile a generated Markdown article to PDF through pandoc + xelatex (the .md stays the primary artifact). */
async function compileMarkdownToPdf(directory: string, fileName: string): Promise<{ ok: true; pdfPath: string } | { ok: false; error: string }> {
  const pdfName = fileName.replace(/\.(md)$/i, '.pdf')
  const pdfPath = join(directory, pdfName)
  const args = [fileName, '-o', pdfName, '--pdf-engine=xelatex', '-V', `CJKmainfont=${cjkMainFont()}`]
  if (process.platform === 'win32') args.push('--pdf-engine-opt=--enable-installer')
  let firstFailure: string | undefined
  for (const command of pandocCandidates()) {
    const result = await runCommand(command, args, directory, 150_000)
    if (!result.ok) {
      if (result.code !== null || !result.output.includes('ENOENT')) {
        firstFailure = `pandoc failed: ${result.output.trim()}`
      }
      continue
    }
    if (!existsSync(pdfPath)) return { ok: false, error: 'pandoc finished but produced no PDF' }
    return { ok: true, pdfPath }
  }
  return { ok: false, error: firstFailure ?? 'pandoc was not found — install it (e.g. winget install JohnMacFarlane.Pandoc) to compile Markdown to PDF' }
}

/** Compile a generated LaTeX source to PDF with xelatex (two passes so \label/\ref resolve). */
async function compileLatexToPdf(directory: string, fileName: string): Promise<{ ok: true; pdfPath: string } | { ok: false; error: string }> {
  const pdfPath = join(directory, fileName.replace(/\.(tex)$/i, '.pdf'))
  const args = ['-interaction=nonstopmode', '-halt-on-error', '-synctex=1']
  if (process.platform === 'win32') args.push('--enable-installer')
  args.push(fileName)
  let firstFailure: string | undefined
  for (const command of xelatexCandidates()) {
    const first = await runCommand(command, args, directory, 100_000)
    if (!first.ok) {
      if (first.code !== null || !first.output.includes('ENOENT')) {
        firstFailure = `xelatex failed: ${first.output.trim()}`
      }
      continue
    }
    await runCommand(command, args, directory, 100_000)
    if (!existsSync(pdfPath)) return { ok: false, error: 'xelatex finished but produced no PDF' }
    return { ok: true, pdfPath }
  }
  return { ok: false, error: firstFailure ?? 'xelatex was not found on this machine' }
}

/** Start a background generation job and return its id; progress is polled via GET /generate-progress. */
function startGenerateJob(
  ctx: GenerateContext,
  deps: GenerateDeps,
  record: Record,
  directory: string,
  fileName: string,
  language: ArticleLanguage,
  format: ArticleFormat,
  compile: boolean,
): string {
  const jobId = randomUUID()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 300_000)
  const job: GenerateJob = { status: 'running', percent: 5, phase: GenerationPhase.Prepare, abort: () => controller.abort() }
  generateJobs.set(jobId, job)
  void (async () => {
    try {
      job.percent = 10
      job.phase = GenerationPhase.Generate
      const article = await generateArticle(ctx, record, controller.signal, language, format, (percent) => { job.percent = percent })
      job.phase = GenerationPhase.Write
      job.percent = 92
      // LaTeX generations own a folder named after the file: every artifact —
      // source, PDF and the compiler's .aux/.log/.synctex.gz — stays inside it.
      const isLatex = format === ArticleFormat.Latex
      const targetDir = isLatex ? join(directory, fileName.replace(/\.tex$/i, '')) : directory
      mkdirSync(targetDir, { recursive: true })
      const target = join(targetDir, fileName)
      writeFileSync(target, article, 'utf8')
      if (compile) {
        job.phase = GenerationPhase.Compile
        job.percent = 96
        const compiled = isLatex
          ? await compileLatexToPdf(targetDir, fileName)
          : await compileMarkdownToPdf(directory, fileName)
        if (compiled.ok) job.pdfPath = compiled.pdfPath
        else job.compileError = compiled.error
      }
      job.status = 'done'
      job.percent = 100
      job.path = target
    } catch (error) {
      job.status = 'error'
      job.error = error instanceof Error ? error.message : String(error)
    } finally {
      clearTimeout(timeout)
      setTimeout(() => { generateJobs.delete(jobId) }, 60_000)
    }
  })()
  return jobId
}

/** Validate the generation request and start the job; throws on bad input. */
function beginGenerate(ctx: GenerateContext, deps: GenerateDeps, url: string): { jobId: string } {
  const params = new URL(url, 'http://dsh.local').searchParams
  const recordId = params.get('recordId') ?? ''
  const formatParam = params.get('format') ?? ArticleFormat.Markdown
  if (!isArticleFormat(formatParam)) throw new Error(`unsupported format "${formatParam}"`)
  const languageParam = params.get('language') ?? ArticleLanguage.Auto
  if (!isArticleLanguage(languageParam)) throw new Error(`unsupported language "${languageParam}"`)
  const directory = (params.get('directory') ?? '').trim()
  if (directory.length === 0) throw new Error('output directory is required')
  const record = deps.loadRecord(recordId)
  if (record === undefined) throw new Error(`record "${recordId}" not found`)

  const rawName = (params.get('fileName') ?? '').trim()
  const fileName = rawName.length === 0
    ? normalizeFileName(`electro-lab-${record.id.slice(0, 8)}`, formatParam)
    : normalizeFileName(rawName, formatParam)

  const compile = params.get('compile') === 'true'

  return { jobId: startGenerateJob(ctx, deps, record, directory, fileName, languageParam, formatParam, compile) }
}

/** Register every generation endpoint; returns one disposer for all of them. */
export function registerGenerateEndpoints(ctx: GenerateContext, deps: GenerateDeps): () => void {
  const disposers: Array<() => void> = []

  // Start a generation job: POST ?recordId=&format=&directory=&fileName=&language=&compile=.
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: GENERATE_PATH,
    handler: (req, res) => {
      const request = req as RequestLike
      if ((request.method ?? 'GET') !== 'POST') {
        res.statusCode = 405
        res.end('method not allowed')
        return
      }
      try {
        const { jobId } = beginGenerate(ctx, deps, request.url ?? '')
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ jobId }))
      } catch (error) {
        res.statusCode = 400
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
      }
    },
  }))

  // Host-driven directory listing for the output-directory browser.
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: LIST_DIRS_PATH,
    handler: (req, res) => {
      const request = req as RequestLike
      if ((request.method ?? 'GET') !== 'GET') {
        res.statusCode = 405
        res.end('method not allowed')
        return
      }
      const path = request.url === undefined ? '' : new URL(request.url, 'http://dsh.local').searchParams.get('path') ?? ''
      try {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(listDirectories(path)))
      } catch (error) {
        res.statusCode = 400
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
      }
    },
  }))

  // Tree roots for the directory browser.
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: LIST_ROOTS_PATH,
    handler: (req, res) => {
      const request = req as RequestLike
      if ((request.method ?? 'GET') !== 'GET') {
        res.statusCode = 405
        res.end('method not allowed')
        return
      }
      const drives = listDriveRoots()
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ roots: drives.length > 0 ? drives : [homedir()] }))
    },
  }))

  // The vendored directory-tree stylesheet (fetched once, injected by the client).
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: DIRECTORY_TREE_CSS_PATH,
    handler: (req, res) => {
      const request = req as RequestLike
      if ((request.method ?? 'GET') !== 'GET') {
        res.statusCode = 405
        res.end('method not allowed')
        return
      }
      res.setHeader('content-type', 'text/css')
      res.end(readDirectoryTreeCss())
    },
  }))

  // Cancel a running job: POST ?jobId=.
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: GENERATE_CANCEL_PATH,
    handler: (req, res) => {
      const request = req as RequestLike
      if ((request.method ?? 'GET') !== 'POST') {
        res.statusCode = 405
        res.end('method not allowed')
        return
      }
      const jobId = request.url === undefined ? null : new URL(request.url, 'http://dsh.local').searchParams.get('jobId')
      const job = jobId === null ? undefined : generateJobs.get(jobId)
      if (job !== undefined && job.status === 'running') job.abort()
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ cancelled: job !== undefined && job.status === 'running' }))
    },
  }))

  // Reveal/open a generated file in the OS: POST ?path=&action=open|reveal.
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: REVEAL_PATH,
    handler: async (req, res) => {
      const request = req as RequestLike
      if ((request.method ?? 'GET') !== 'POST') {
        res.statusCode = 405
        res.end('method not allowed')
        return
      }
      const url = new URL(request.url ?? '', 'http://dsh.local')
      const target = url.searchParams.get('path') ?? ''
      if (target.length === 0) {
        res.statusCode = 400
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'path is required' }))
        return
      }
      const action = url.searchParams.get('action') === 'open' ? 'open' : 'reveal'
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ result: await launchInOs(target, action) }))
    },
  }))

  // Generation progress: GET ?jobId=.
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: GENERATE_PROGRESS_PATH,
    handler: (req, res) => {
      const request = req as RequestLike
      if ((request.method ?? 'GET') !== 'GET') {
        res.statusCode = 405
        res.end('method not allowed')
        return
      }
      const jobId = request.url === undefined ? null : new URL(request.url, 'http://dsh.local').searchParams.get('jobId')
      const job = jobId === null ? undefined : generateJobs.get(jobId)
      if (job === undefined) {
        res.statusCode = 404
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'generation job not found' }))
        return
      }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({
        status: job.status,
        percent: job.percent,
        phase: job.phase,
        ...(job.path === undefined ? {} : { path: job.path }),
        ...(job.pdfPath === undefined ? {} : { pdfPath: job.pdfPath }),
        ...(job.compileError === undefined ? {} : { compileError: job.compileError }),
        ...(job.error === undefined ? {} : { error: job.error }),
      }))
    },
  }))

  // Remembered generation state (directory/language/format/compile): GET reads, PUT saves.
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: GENERATE_DIR_PATH,
    handler: (req, res) => {
      const request = req as RequestLike
      const method = request.method ?? 'GET'
      if (method === 'PUT') {
        const url = new URL(request.url ?? '', 'http://dsh.local')
        const dir = url.searchParams.get('dir')
        const language = url.searchParams.get('language')
        const format = url.searchParams.get('format')
        const compileParam = url.searchParams.get('compile')
        const state: GenerateState = {}
        if (dir !== null) state.generateDir = dir
        if (language !== null) state.generateLanguage = language
        if (format !== null) state.generateFormat = format
        if (compileParam === 'true' || compileParam === 'false') state.generateCompile = compileParam === 'true'
        writeGenerateState(deps.home, state)
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ saved: true }))
        return
      }
      if (method !== 'GET') {
        res.statusCode = 405
        res.end('method not allowed')
        return
      }
      const state = readGenerateState(deps.home)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({
        directory: state.generateDir ?? '',
        language: state.generateLanguage ?? 'auto',
        format: state.generateFormat ?? 'markdown',
        compile: state.generateCompile ?? false,
      }))
    },
  }))

  return () => {
    for (const off of disposers) off()
  }
}
