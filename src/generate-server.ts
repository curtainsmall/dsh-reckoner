/**
 * Host article generation subsystem: LLM article jobs, file writing, optional
 * PDF compilation for LaTeX (delegated to latexmk), OS reveal/open, host-driven
 * directory browsing and the remembered generation settings. Ported from the v0.9.0
 * generation feature and wired to the engine record store through the
 * `loadRecord` dependency — this module has no Cordis imports; `register`
 * takes the services it needs (web server, optional llm/agentDefaultModel).
 */
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { readState, updateState } from './state.ts'
import { log } from './log.ts'
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
export const GENERATE_CAPABILITY_PATH = '/api/dsh-electro-lab/generate-capability'

/** Legacy plain-text location of the remembered directory (migrated on read). */
const LEGACY_GENERATE_DIR_FILE = 'generate-dir.txt'

/** Remembered generation state: output directory, article language, format and PDF-compile toggle. */
interface GenerateState {
  generateDir?: string
  generateLanguage?: string
  generateFormat?: string
  generateCompile?: boolean
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
  const stored = readState(home)
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

/** Persist the generation settings into the shared state file; undefined fields keep their stored values. */
function writeGenerateState(home: string, state: GenerateState): void {
  updateState(home, (stored) => {
    for (const [key, value] of Object.entries(state)) {
      if (value !== undefined) stored[key] = value
    }
    // Drop anything empty or invalid rather than keeping a key no reader would trust.
    if (typeof stored.generateDir !== 'string' || stored.generateDir.trim().length === 0) delete stored.generateDir
    if (typeof stored.generateLanguage !== 'string' || stored.generateLanguage.length === 0) delete stored.generateLanguage
    if (!isArticleFormat(stored.generateFormat)) delete stored.generateFormat
    if (typeof stored.generateCompile !== 'boolean') delete stored.generateCompile
  })
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
  status: 'running' | 'done' | 'error' | 'interrupted'
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

/**
 * The LaTeX drivers compilation is delegated to, in order: latexmk (TeX Live, and MiKTeX with its Perl
 * runtime), then texify (MiKTeX's own driver, no Perl). Both decide themselves how many engine passes
 * a document needs.
 */
const LATEX_DRIVERS: Array<{ command: string; args: string[] }> = [
  { command: 'latexmk', args: ['-pdfxe', '-interaction=nonstopmode', '-halt-on-error', '-synctex=1'] },
  { command: 'texify', args: ['--pdf', '--engine=xetex', '--synctex=1', '--tex-option=--interaction=nonstopmode'] },
]
/** One driver's own budget; it runs the engine as often as it needs inside it. */
const COMPILE_TIMEOUT_MS = 120_000
/** What the dialog says when no driver is installed at all. */
const NO_DRIVER_MESSAGE = 'no LaTeX driver found (latexmk or texify)'

/** Where one driver binary is looked for: PATH first, then the known MiKTeX install locations on Windows. */
function driverCandidates(command: string): string[] {
  const candidates = [command]
  if (process.platform === 'win32') {
    for (const root of listDriveRoots()) {
      candidates.push(join(root, 'MiKTeX', 'miktex', 'bin', 'x64', `${command}.exe`))
    }
    const local = process.env.LOCALAPPDATA
    if (local !== undefined) candidates.push(join(local, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64', `${command}.exe`))
    candidates.push(`C:\\Program Files\\MiKTeX\\miktex\\bin\\x64\\${command}.exe`)
    candidates.push(`C:\\Program Files (x86)\\MiKTeX\\miktex\\bin\\x64\\${command}.exe`)
  }
  return candidates
}

/**
 * One short line for the dialog; a driver's full output goes to the log, where length costs nothing.
 * A TeX error line (the engine marks those with `!`) says the most, then a line naming a cause, and
 * only then the driver's own wrapper line — its banner is worth nothing to the reader.
 */
function firstLine(text: string): string {
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
  const line = lines.find((part) => part.startsWith('!'))
    ?? lines.find((part) => /error|could not|can't|cannot|not found/i.test(part))
    ?? lines.find((part) => /did not succeed/i.test(part))
    ?? lines[0]
    ?? ''
  return line.length > 120 ? `${line.slice(0, 120)}…` : line
}

/**
 * Compile a generated LaTeX source to PDF by handing it to a driver, which owns how many times a TeX
 * engine runs (cross-references, page numbers, bibliographies) — this module never decides that, and
 * never runs an engine itself as a substitute. `missing` means no driver was installed; `failed` means
 * one ran and did not produce a PDF, with its own message as the detail.
 */
async function compileLatexToPdf(directory: string, fileName: string): Promise<{ ok: true; pdfPath: string } | { ok: false; kind: 'missing' | 'failed'; detail: string }> {
  const pdfPath = join(directory, fileName.replace(/\.(tex)$/i, '.pdf'))
  let failure: string | undefined
  for (const driver of LATEX_DRIVERS) {
    for (const command of driverCandidates(driver.command)) {
      const result = await runCommand(command, [...driver.args, fileName], directory, COMPILE_TIMEOUT_MS)
      if (!result.ok) {
        // ENOENT means this location holds no driver; anything else means it ran and complained, so
        // there is no point trying its other locations — record it and move on to the next driver.
        if (result.code === null) continue
        failure = result.output.trim()
        log.warn('latex driver failed', { driver: driver.command, error: failure })
        break
      }
      if (!existsSync(pdfPath)) return { ok: false, kind: 'failed', detail: `${driver.command} finished but produced no PDF` }
      return { ok: true, pdfPath }
    }
  }
  return failure === undefined
    ? { ok: false, kind: 'missing', detail: 'neither latexmk nor texify is installed' }
    : { ok: false, kind: 'failed', detail: failure }
}

/* ── Capability pre-flight ─────────────────────────────────────────────────── */

/** How long a capability report is reused before the drivers are probed again. */
const CAPABILITY_TTL_MS = 30_000
/** A probe is only a version query; a driver that does not answer quickly is unusable anyway. */
const PROBE_TIMEOUT_MS = 5_000

/** The macros each document shell needs (a missing one is a hint, never a block: MiKTeX installs on demand). */
const SHELL_PACKAGES: { [language in TemplateLanguage]: string[] } = {
  [TemplateLanguage.ZhCN]: ['ctexart.cls'],
  [TemplateLanguage.En]: ['fontspec.sty', 'unicode-math.sty', 'siunitx.sty'],
}

interface DriverProbe {
  command: string
  ok: boolean
  /** Why the driver cannot be used, in one short line, when it cannot. */
  detail?: string
}

/** What this machine can compile with, and what its shells may be missing. */
export interface CapabilityReport {
  /** The driver compilation will use, or null when this machine has none. */
  driver: string | null
  drivers: DriverProbe[]
  missingPackages: string[]
  /** When this report was produced; the host probes again after CAPABILITY_TTL_MS. */
  checkedAt: number
}

/** Probe one driver by asking for its version: exit 0 means it can run at all. */
async function probeDriver(command: string): Promise<DriverProbe> {
  for (const candidate of driverCandidates(command)) {
    const result = await runCommand(candidate, ['--version'], homedir(), PROBE_TIMEOUT_MS)
    if (!result.ok) {
      if (result.code === null) continue
      return { command, ok: false, detail: firstLine(result.output) }
    }
    return { command, ok: true }
  }
  return { command, ok: false, detail: 'not installed' }
}

/** Which of the asked languages' shell macros kpsewhich cannot find; no kpsewhich at all means all of them. */
async function probePackages(language: ArticleLanguage): Promise<string[]> {
  const templates = language === ArticleLanguage.ZhCN
    ? [TemplateLanguage.ZhCN]
    : language === ArticleLanguage.En
      ? [TemplateLanguage.En]
      : [TemplateLanguage.ZhCN, TemplateLanguage.En]
  const missing: string[] = []
  for (const template of templates) {
    for (const file of SHELL_PACKAGES[template]) {
      const found = await runCommand('kpsewhich', [file], homedir(), PROBE_TIMEOUT_MS)
      if (!found.ok || found.output.trim().length === 0) missing.push(file)
    }
  }
  return missing
}

const capabilityCache = new Map<string, CapabilityReport>()

/** The capability report for one article language, probed at most once per CAPABILITY_TTL_MS. */
async function readCapability(language: ArticleLanguage): Promise<CapabilityReport> {
  const cached = capabilityCache.get(language)
  if (cached !== undefined && Date.now() - cached.checkedAt < CAPABILITY_TTL_MS) return cached
  const drivers: DriverProbe[] = []
  for (const driver of LATEX_DRIVERS) {
    const probe = await probeDriver(driver.command)
    drivers.push(probe)
    if (probe.ok) break
  }
  const driver = drivers.find((probe) => probe.ok)?.command ?? null
  const report: CapabilityReport = {
    driver,
    drivers,
    // With no driver at all the packages decide nothing, and probing them would only add latency.
    missingPackages: driver === null ? [] : await probePackages(language),
    checkedAt: Date.now(),
  }
  capabilityCache.set(language, report)
  return report
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
  const startedAt = Date.now()
  const job: GenerateJob = { status: 'running', percent: 5, phase: GenerationPhase.Prepare, abort: () => controller.abort() }
  generateJobs.set(jobId, job)
  void (async () => {
    log.info('article generation started', { format, language, file: fileName, dir: directory })
    try {
      job.percent = 10
      job.phase = GenerationPhase.Generate
      const article = await generateArticle(ctx, record, controller.signal, language, format, (percent) => { job.percent = percent })
      job.phase = GenerationPhase.Write
      job.percent = 92
      // LaTeX generations own a folder named after the file: every artifact —
      // source, PDF and the compiler's .aux/.log/.synctex.gz — stays inside it.
      // Markdown is written flat and is never compiled (PDF is LaTeX-only).
      const isLatex = format === ArticleFormat.Latex
      const targetDir = isLatex ? join(directory, fileName.replace(/\.tex$/i, '')) : directory
      mkdirSync(targetDir, { recursive: true })
      const target = join(targetDir, fileName)
      writeFileSync(target, article, 'utf8')
      if (compile && isLatex) {
        job.phase = GenerationPhase.Compile
        job.percent = 96
        const compiled = await compileLatexToPdf(targetDir, fileName)
        if (compiled.ok) {
          job.pdfPath = compiled.pdfPath
        } else if (compiled.kind === 'missing') {
          // No driver installed: the source is written, but the run stops here. The dialog gets one
          // short line; the driver's own message (long install instructions) goes to the log.
          log.warn('latex compile failed', { file: target, error: compiled.detail })
          job.status = 'interrupted'
          job.percent = 100
          job.path = target
          job.error = NO_DRIVER_MESSAGE
          return
        } else {
          // The source is fine as far as we know and the article was written: report the driver's first
          // line (the full output is in the log) and keep the run's outcome as done.
          log.warn('latex compile failed', { file: target, error: compiled.detail })
          job.compileError = firstLine(compiled.detail)
        }
      }
      job.status = 'done'
      job.percent = 100
      job.path = target
      log.info('article generation finished', { format, took_ms: Date.now() - startedAt, path: target })
    } catch (error) {
      job.status = 'error'
      job.error = error instanceof Error ? error.message : String(error)
      log.error('article generation failed', { format, took_ms: Date.now() - startedAt, error })
    } finally {
      clearTimeout(timeout)
      setTimeout(() => { generateJobs.delete(jobId) }, 60_000)
    }
  })()
  return jobId
}

/** Validate the generation request and start the job; throws on bad input. */
async function beginGenerate(ctx: GenerateContext, deps: GenerateDeps, url: string): Promise<{ jobId: string }> {
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
  // Pre-flight: never spend a model call on an article that cannot be compiled. The job checks again.
  if (compile && formatParam === ArticleFormat.Latex && (await readCapability(languageParam)).driver === null) {
    throw new Error(NO_DRIVER_MESSAGE)
  }

  return { jobId: startGenerateJob(ctx, deps, record, directory, fileName, languageParam, formatParam, compile) }
}

/** Register every generation endpoint; returns one disposer for all of them. */
export function registerGenerateEndpoints(ctx: GenerateContext, deps: GenerateDeps): () => void {
  const disposers: Array<() => void> = []

  // Start a generation job: POST ?recordId=&format=&directory=&fileName=&language=&compile=.
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: GENERATE_PATH,
    handler: async (req, res) => {
      const request = req as RequestLike
      if ((request.method ?? 'GET') !== 'POST') {
        res.statusCode = 405
        res.end('method not allowed')
        return
      }
      try {
        const { jobId } = await beginGenerate(ctx, deps, request.url ?? '')
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ jobId }))
      } catch (error) {
        res.statusCode = 400
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
      }
    },
  }))

  // Capability pre-flight for the setup dialog: which driver can run here, which shell macros are missing.
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: GENERATE_CAPABILITY_PATH,
    handler: async (req, res) => {
      const request = req as RequestLike
      if ((request.method ?? 'GET') !== 'GET') {
        res.statusCode = 405
        res.end('method not allowed')
        return
      }
      const languageParam = request.url === undefined ? null : new URL(request.url, 'http://dsh.local').searchParams.get('language')
      const language = languageParam !== null && isArticleLanguage(languageParam) ? languageParam : ArticleLanguage.Auto
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(await readCapability(language)))
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
