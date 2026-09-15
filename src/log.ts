/**
 * Plugin logging: one text line per event, two sinks (stdout, one file per host run).
 *
 * The file sink writes `<home>/logs/<YYYY-MM-DD_HH-mm-ss.SSS>.log` — one file per plugin mount,
 * that is per host run — containing nothing but event lines. The run's own state lives beside the
 * other home state, in `<home>/log-index.jsonl`: one row per run, appended when the run starts and
 * sealed with its `endedAt` when the plugin unmounts, so a row still carrying `endedAt: null` is a
 * run that did not unmount. That row (`{name, startedAt, endedAt, pid, level}`) never enters the
 * log text, which keeps both sinks line-for-line identical.
 *
 * A line is `<timestamp> <LEVEL> <message>[ k=v …]`:
 *
 *   2025-06-14 12:03:41.882 WARN  external call failed solver=echo ep=http://127.0.0.1:8787 took_ms=1523 code=EXTERNAL_TIMEOUT
 *
 * The head is positional (timestamp, level label padded to 5, message); the tail is the
 * `key=value` rendering of the object handed to the log call. Field values are JSON
 * types only. The object itself may be anything (a class instance is fine) and is
 * expanded exactly one level — own enumerable data properties, never the prototype
 * chain, never a getter — while every value is atomized: a nested object or array
 * becomes one compact-JSON token, never nested `k=v`. Rendering never recurses, which is
 * what makes a whole object logged by accident visibly long while picked fields stay
 * short. Logging a picked field set is the intended use.
 *
 * Outside that domain the renderer stays total and never throws: `undefined` drops the key, an
 * Error renders as its message with its stack appended as `  | ` continuation lines, and a
 * bigint, function, symbol or circular reference renders `[unserializable]`. One value is cut
 * at VALUE_LIMIT characters.
 *
 * Reading a tail needs two rules, because whitespace and `=` are the only separators:
 * read a key up to the first `=`; then, if the value starts with `"`, read to the next
 * unescaped `"` — otherwise read to the next whitespace. A value therefore carries no
 * whitespace unless quoted, and a message never contains `=`.
 *
 * Messages are a fixed English vocabulary, one per event — they are the only grep anchor:
 *   plugin mounted · plugin unmounted · declaration skipped · presets synced ·
 *   preset sync failed · skill not registered · endpoint failed · log file sink unavailable ·
 *   engine op failed · external call ok · external call failed ·
 *   article generation started · article generation finished · article generation failed ·
 *   latex compile failed
 *
 * Unit suffixes belong to the call site (`took_ms=1523`, never `ms=1523`): a key names a
 * quantity and carries its unit, so a unit change is a new key instead of a silent shift.
 *
 * Logging is disposable run-time diagnostics, never the engine's bookkeeping: the record
 * trace is the authoritative account of a calculation, no record field is derived from a
 * log line, and nothing record- or session-shaped (record id, sequence, job id) is logged
 * as a key. Every write is guarded — a failing sink is disabled instead of throwing — and
 * this module imports no engine, record or tool code (host side only; never bundled into
 * the client).
 */
import {
  appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, writeSync,
} from 'node:fs'
import { join, basename } from 'node:path'

/** Severity, lowest first; Off silences every sink. */
export enum LogLevel {
  Debug = 'debug',
  Info = 'info',
  Warn = 'warn',
  Error = 'error',
  Off = 'off',
}

/** The object handed to a log call: any object, JSON-typed values. */
export type LogFields = object

/** One destination for finished lines. A sink reports its own failure by throwing; the logger disables it. */
export interface LogSink {
  write(line: string, level: LogLevel): void
}

/** The plugin's log surface. */
export interface Logger {
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
}

const LEVEL_LABEL: Record<LogLevel, string> = {
  [LogLevel.Debug]: 'DEBUG',
  [LogLevel.Info]: 'INFO',
  [LogLevel.Warn]: 'WARN',
  [LogLevel.Error]: 'ERROR',
  [LogLevel.Off]: 'OFF',
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  [LogLevel.Debug]: 0,
  [LogLevel.Info]: 1,
  [LogLevel.Warn]: 2,
  [LogLevel.Error]: 3,
  [LogLevel.Off]: 4,
}

/** Longest atomized value: one huge object must not push a line past readability. */
const VALUE_LIMIT = 200
/** Stack lines appended for an Error logged as a field value. */
const STACK_LIMIT = 10
/** Continuation prefix: `grep -v '^  |'` turns a file back into one line per event. */
const CONTINUATION = '  | '
/** Retention: run files kept under logs/ and the total size they may occupy. */
const KEEP_RUNS = 20
const MAX_RUN_BYTES = 50 * 1024 * 1024
/** A run file is named by its creation timestamp, so `ls` sorts runs by age; RUN_NAME is what retention owns. */
const RUN_SUFFIX = '.log'
const RUN_NAME = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.\d{3}(-\d+)?\.log$/
/** The run index beside the other home state (records/ ↔ record-index.jsonl, logs/ ↔ log-index.jsonl). */
const INDEX_FILE = 'log-index.jsonl'

interface SinkEntry {
  sink: LogSink
  enabled: boolean
}

let level: LogLevel = LogLevel.Info
let sinks: SinkEntry[] = []

/** Parse a `DSH_ELECTRO_LAB_LOG_LEVEL` word; anything unknown keeps the default. */
export function resolveLevel(word: string | undefined): LogLevel {
  switch (word?.trim().toLowerCase()) {
    case 'debug': return LogLevel.Debug
    case 'warn': return LogLevel.Warn
    case 'error': return LogLevel.Error
    case 'off': return LogLevel.Off
    default: return LogLevel.Info
  }
}

/** Set the one global level shared by every sink. */
export function setLevel(next: LogLevel): void {
  level = next
}

/** Local time, `YYYY-MM-DD HH:mm:ss.SSS`; meta.json carries the ISO instants instead. */
function stamp(date: Date): string {
  const pad = (value: number, width: number): string => String(value).padStart(width, '0')
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`
  const time = `${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}.${pad(date.getMilliseconds(), 3)}`
  return `${day} ${time}`
}

/** Directory name from the line timestamp: no space in a path, and `:` is illegal on Windows. */
function dirStamp(date: Date): string {
  return stamp(date).replace(' ', '_').replace(/:/g, '-')
}

/** A message sits in the head: control characters are escaped, never emitted raw. */
function inline(text: string): string {
  return text.replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t')
}

/** Whether a value needs quoting: empty, carrying a separator, or opening with an ambiguous quote. */
function needsQuotes(text: string): boolean {
  return text.length === 0 || text.startsWith('"') || /[\s=]/.test(text)
}

/** Cut one over-long token, keeping the head of it: readability beats completeness in a line. */
function capped(text: string): string {
  return text.length > VALUE_LIMIT ? `${text.slice(0, VALUE_LIMIT)}…` : text
}

function renderText(text: string): string {
  if (!needsQuotes(text)) return text
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t')
  return `"${escaped}"`
}

/** One field value as a single token; anything outside the JSON domain degrades to a marker instead of throwing. */
function renderValue(value: unknown): string | undefined {
  if (value === undefined) return undefined // the key is dropped, as in JSON
  if (value === null) return 'null'
  if (typeof value === 'string') return renderText(capped(value))
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Error) return renderText(value.message) // JSON.stringify would answer {}
  let text: string | undefined
  try {
    text = JSON.stringify(value)
  } catch {
    // bigint and circular references throw; a log call must not.
    return '[unserializable]'
  }
  if (text === undefined) return '[unserializable]' // function, symbol
  return renderText(capped(text))
}

/** Own enumerable data properties in insertion order; accessors are skipped so a getter can never run. */
function dataFields(fields: LogFields): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = []
  for (const key of Object.keys(fields)) {
    const descriptor = Object.getOwnPropertyDescriptor(fields, key)
    if (descriptor === undefined || !('value' in descriptor)) continue
    out.push([key, descriptor.value])
  }
  return out
}

/** The ` k=v …` tail; empty when there is nothing to render. */
function renderTail(fields: LogFields | undefined): string {
  if (fields === undefined || fields === null || typeof fields !== 'object') return ''
  // An array is not a field bag: it becomes one value token.
  if (Array.isArray(fields)) {
    const text = renderValue(fields)
    return text === undefined ? '' : ` value=${text}`
  }
  const parts: string[] = []
  for (const [key, value] of dataFields(fields)) {
    const text = renderValue(value)
    if (text === undefined) continue
    parts.push(`${renderText(key)}=${text}`)
  }
  return parts.length === 0 ? '' : ` ${parts.join(' ')}`
}

/** `  | `-prefixed stack continuation lines for every Error logged as a field value. */
function renderStacks(fields: LogFields | undefined): string {
  if (fields === undefined || fields === null || typeof fields !== 'object' || Array.isArray(fields)) return ''
  let out = ''
  for (const [, value] of dataFields(fields)) {
    if (!(value instanceof Error) || typeof value.stack !== 'string') continue
    for (const line of value.stack.split('\n').slice(0, STACK_LIMIT)) out += `\n${CONTINUATION}${line.trimEnd()}`
  }
  return out
}

/** One log line, plus continuation lines when an Error's stack is logged with it. */
export function formatLine(severity: LogLevel, message: string, fields?: LogFields, at: Date = new Date()): string {
  return `${stamp(at)} ${LEVEL_LABEL[severity].padEnd(5)} ${inline(message)}${renderTail(fields)}${renderStacks(fields)}`
}

/** Logger-internal trouble goes straight to stdout: it must never travel through a sink that may be the broken one. */
function reportInternal(problem: string): void {
  process.stdout.write(`[dsh-electro-lab] logger: ${problem}\n`)
}

function emit(severity: LogLevel, message: string, fields?: LogFields): void {
  if (LEVEL_ORDER[severity] < LEVEL_ORDER[level]) return
  const line = formatLine(severity, message, fields)
  for (const entry of sinks) {
    if (!entry.enabled) continue
    try {
      entry.sink.write(line, severity)
    } catch (error) {
      entry.enabled = false
      reportInternal(`sink disabled after a write failure: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/** The plugin's one logger. With no sink attached (module load, tests) every call is a no-op. */
export const log: Logger = {
  debug: (message, fields) => emit(LogLevel.Debug, message, fields),
  info: (message, fields) => emit(LogLevel.Info, message, fields),
  warn: (message, fields) => emit(LogLevel.Warn, message, fields),
  error: (message, fields) => emit(LogLevel.Error, message, fields),
}

function addSink(sink: LogSink): () => void {
  const entry: SinkEntry = { sink, enabled: true }
  sinks = [...sinks, entry]
  return () => {
    sinks = sinks.filter((item) => item !== entry)
  }
}

/** Replace every sink; returns a detach for the whole set. Used by tests. */
export function setSinks(...list: LogSink[]): () => void {
  const previous = sinks
  sinks = list.map((sink) => ({ sink, enabled: true }))
  return () => {
    sinks = previous
  }
}

const LEVEL_COLOR: Partial<Record<LogLevel, string>> = {
  [LogLevel.Debug]: '\u001b[2m',
  [LogLevel.Warn]: '\u001b[33m',
  [LogLevel.Error]: '\u001b[31m',
}

/** Console sink: every line on stdout, the level label colored when stdout is a terminal. */
export function attachConsoleSink(): () => void {
  return addSink({
    write: (line, severity) => {
      const color = LEVEL_COLOR[severity]
      const label = LEVEL_LABEL[severity]
      const at = color === undefined ? -1 : line.indexOf(label)
      const text = color === undefined || at < 0 || process.stdout.isTTY !== true
        ? line
        : `${line.slice(0, at)}${color}${label}\u001b[0m${line.slice(at + label.length)}`
      process.stdout.write(`${text}\n`)
    },
  })
}

/** A run file's own state, not an event: one row in log-index.jsonl, mirroring a record index row. */
interface RunFile {
  name: string
  file: string
  index: string
  fd: number
  detach: () => void
  closed: boolean
}

/** One run-index row: `{id, openedAt, sealedAt}` for a record is `{name, startedAt, endedAt}` for a run. */
interface RunRow {
  name: string
  startedAt: number
  endedAt: number | null
  pid: number
  level: LogLevel
}

let activeRun: RunFile | null = null

/** Read every run row; a missing or corrupt file reads as none (corrupt lines are skipped, like the record index). */
function readRuns(index: string): RunRow[] {
  try {
    const rows: RunRow[] = []
    for (const text of readFileSync(index, 'utf8').split('\n')) {
      if (text.trim().length === 0) continue
      try {
        const row = JSON.parse(text) as RunRow
        if (typeof row.name === 'string' && typeof row.startedAt === 'number') rows.push(row)
      } catch {
        // skip a corrupt row rather than losing the index
      }
    }
    return rows
  } catch {
    return []
  }
}

function writeRuns(index: string, rows: RunRow[]): void {
  writeFileSync(index, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : ''), 'utf8')
}

/** Index bookkeeping is best effort throughout: a run never loses its log because its row could not be written. */
function appendRun(index: string, row: RunRow): void {
  try {
    appendFileSync(index, `${JSON.stringify(row)}\n`, 'utf8')
  } catch {
    // the run simply has no index row
  }
}

/** Seal one run with its endedAt. */
function sealRun(index: string, name: string, endedAt: number): void {
  try {
    const rows = readRuns(index)
    const at = rows.findIndex((row) => row.name === name)
    if (at === -1) return
    rows[at] = { ...rows[at]!, endedAt }
    writeRuns(index, rows)
  } catch {
    // the row keeps endedAt: null and reads as an unfinished run
  }
}

/** Drop rows whose log file is gone (retention removed it, or the user did). */
function pruneRunRows(index: string, root: string, current: string): void {
  try {
    const present = new Set(readdirSync(root))
    present.add(current)
    writeRuns(index, readRuns(index).filter((row) => present.has(row.name)))
  } catch {
    // a stale row is harmless: the file it names is gone
  }
}

/** Create the run file; a taken name (a re-mounted plugin in the same millisecond) steps 1 ms forward. */
function createRunFile(root: string): { file: string; fd: number } {
  let at = Date.now()
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const file = join(root, `${dirStamp(new Date(at))}${RUN_SUFFIX}`)
    if (!existsSync(file)) return { file, fd: openSync(file, 'a') }
    at += 1
  }
  // Pathological clock: a pid-suffixed name (RUN_NAME tolerates the suffix, so retention still owns it).
  const file = join(root, `${dirStamp(new Date(at))}-${String(process.pid)}${RUN_SUFFIX}`)
  return { file, fd: openSync(file, 'a') }
}

function fileBytes(file: string): number {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

/** Every run file except the current one, oldest first (the name is the creation timestamp, so it sorts by age). */
function otherRuns(root: string, current: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && RUN_NAME.test(entry.name))
    .map((entry) => entry.name)
    .filter((name) => name !== current)
    .sort()
}

/** Retention: the newest KEEP_RUNS files, at most MAX_RUN_BYTES in total; the current run is never removed. */
function pruneRuns(root: string, current: string): void {
  const older = otherRuns(root, current)
  for (const name of older.slice(0, Math.max(0, older.length + 1 - KEEP_RUNS))) {
    rmSync(join(root, name), { force: true })
  }
  const sized = otherRuns(root, current).map((name) => ({ name, bytes: fileBytes(join(root, name)) }))
  let total = fileBytes(join(root, current)) + sized.reduce((sum, run) => sum + run.bytes, 0)
  for (const run of sized) {
    if (total <= MAX_RUN_BYTES) break
    rmSync(join(root, run.name), { force: true })
    total -= run.bytes
  }
}

function closeRun(run: RunFile | null): void {
  if (run === null || run.closed) return
  run.closed = true
  if (activeRun === run) activeRun = null
  run.detach()
  sealRun(run.index, run.name, Date.now())
  try {
    closeSync(run.fd)
  } catch {
    // already closed
  }
}

/**
 * Attach the per-run file sink: `<home>/logs/<YYYY-MM-DD_HH-mm-ss.SSS>.log` (events only), one file
 * per plugin mount — that is, per host run — pruned to the newest KEEP_RUNS, plus one row in
 * `<home>/log-index.jsonl` holding the run's own state. Writing is synchronous on the opened
 * descriptor, so the last lines survive a crash and nothing needs flushing. Throws only if the log
 * file cannot be created — the caller decides whether logging is worth failing over.
 */
export function attachFileSink(home: string): { file: string; close(): void } {
  closeRun(activeRun)
  const root = join(home, 'logs')
  mkdirSync(root, { recursive: true })
  const { file, fd } = createRunFile(root)
  const name = basename(file)
  const index = join(home, INDEX_FILE)
  appendRun(index, { name, startedAt: Date.now(), endedAt: null, pid: process.pid, level })
  const run: RunFile = { name, file, index, fd, detach: () => {}, closed: false }
  run.detach = addSink({ write: (line) => { writeSync(fd, `${line}\n`) } })
  activeRun = run
  try {
    pruneRuns(root, name)
    pruneRunRows(index, root, name)
  } catch {
    // retention is best effort: never cost the current run its log
  }
  return { file, close: () => { closeRun(run) } }
}
