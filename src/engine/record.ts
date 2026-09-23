/**
 * The record files under one home.
 *
 * Two tiers: the one unclosed record lives in `open-record.jsonl`, and closing
 * it renames that file into `records/<id>.jsonl`. Closing is therefore atomic,
 * so a file under `records/` is always a complete record; the format version
 * each file was written with is its first line.
 */
import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The record design version this build writes and accepts. */
export const RECORD_VERSION = 1

/** One tool's row in a record. */
export type TraceTool = 'eval' | 'set' | 'get' | 'record_start' | 'record_message' | 'record_end'

/** A trace row: what was called, whether it worked, and the content that tool stores. */
export interface TraceRow {
  readonly seq: number
  readonly at: number
  readonly tool: TraceTool
  readonly ok: boolean
  readonly content: Record<string, unknown>
}

/** The first line of every record file: not a trace row, `seq: 0` is its only marker. */
export interface RecordHeader {
  readonly version: number
}

/** One closed record as the list needs it. */
export interface RecordSummary {
  readonly id: string
  readonly title: string
  readonly version: number
  readonly openedAt: number
  readonly endedAt: number
}

/** A record file parsed: its header (absent when the first line is not one) and its trace rows. */
export interface RecordFile {
  readonly header: RecordHeader | null
  readonly rows: TraceRow[]
}

function parseLines(text: string): unknown[] {
  const parsed: unknown[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      parsed.push(JSON.parse(trimmed) as unknown)
    } catch {
      // A torn last line (a crash mid-append) is dropped: the record keeps every row that parsed.
    }
  }
  return parsed
}

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/** Whether a parsed line is the header line. */
function toHeader(value: unknown): RecordHeader | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const bag = value as Record<string, unknown>
  if (bag['seq'] !== 0) return null
  const version = bag['version']
  return typeof version === 'number' ? { version } : null
}

/** Whether a parsed line is a trace row. */
function toRow(value: unknown): TraceRow | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const bag = value as Record<string, unknown>
  const seq = bag['seq']
  const tool = bag['tool']
  const at = bag['at']
  const ok = bag['ok']
  const content = bag['content']
  if (typeof seq !== 'number' || seq <= 0) return null
  if (typeof tool !== 'string' || typeof at !== 'number' || typeof ok !== 'boolean') return null
  if (typeof content !== 'object' || content === null || Array.isArray(content)) return null
  return { seq, at, tool: tool as TraceTool, ok, content: content as Record<string, unknown> }
}

/** Split a record file's text into its header and its rows. */
export function parseRecordFile(text: string): RecordFile {
  const lines = parseLines(text)
  const header = toHeader(lines[0])
  const rows: TraceRow[] = []
  for (const line of header === null ? lines : lines.slice(1)) {
    const row = toRow(line)
    if (row !== null) rows.push(row)
  }
  return { header, rows }
}

/**
 * Order two record ids: they are creation timestamps, so plain string order is
 * creation order - except for the `-2` suffix used when two records were
 * created inside the same millisecond.
 */
export function compareRecordIds(left: string, right: string): number {
  const [leftBase, leftSuffix] = left.split('-')
  const [rightBase, rightSuffix] = right.split('-')
  if (leftBase !== rightBase) return leftBase! < rightBase! ? -1 : 1
  return Number(leftSuffix ?? 1) - Number(rightSuffix ?? 1)
}

/** The record files under one home: `open-record.jsonl` plus `records/<id>.jsonl`. */
export class RecordStore {
  readonly openPath: string
  readonly recordsDir: string

  constructor(readonly home: string) {
    this.openPath = join(home, 'open-record.jsonl')
    this.recordsDir = join(home, 'records')
  }

  /* ── the unclosed record ─────────────────────────────────────────────────── */

  /** Start a fresh unclosed record file: the header line, nothing else. */
  beginOpen(): void {
    mkdirSync(this.home, { recursive: true })
    writeFileSync(this.openPath, `${JSON.stringify({ seq: 0, version: RECORD_VERSION })}\n`, 'utf8')
  }

  appendOpenRow(row: TraceRow): void {
    appendFileSync(this.openPath, `${JSON.stringify(row)}\n`, 'utf8')
  }

  /** The unclosed record, or null when there is none. */
  readOpen(): RecordFile | null {
    const text = readText(this.openPath)
    return text.length === 0 ? null : parseRecordFile(text)
  }

  discardOpen(): void {
    rmSync(this.openPath, { force: true })
  }

  /** Close the unclosed record: its file becomes `records/<id>.jsonl` in one atomic rename. */
  closeOpen(id: string): void {
    mkdirSync(this.recordsDir, { recursive: true })
    renameSync(this.openPath, this.recordPath(id))
  }

  /* ── closed records ──────────────────────────────────────────────────────── */

  recordPath(id: string): string {
    return join(this.recordsDir, `${id}.jsonl`)
  }

  readRecord(id: string): RecordFile | null {
    const text = readText(this.recordPath(id))
    return text.length === 0 ? null : parseRecordFile(text)
  }

  hasRecord(id: string): boolean {
    return readText(this.recordPath(id)).length > 0
  }

  /** The ids of the closed records, newest first. */
  listRecordIds(): string[] {
    let names: string[]
    try {
      names = readdirSync(this.recordsDir)
    } catch {
      return []
    }
    return names
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => name.slice(0, -'.jsonl'.length))
      .sort((left, right) => compareRecordIds(right, left))
  }

  /** The directory's modification time: the roster's invalidation key. */
  recordsDirMtime(): number {
    try {
      return statSync(this.recordsDir).mtimeMs
    } catch {
      return 0
    }
  }

  deleteRecord(id: string): void {
    rmSync(this.recordPath(id), { force: true })
  }
}
