/**
 * The record on disk: one trace file per record plus the index every record
 * appears in. Only numbers and SI vectors are stored - a trace row never
 * carries a unit name, because the name is IO and the vector is the fact.
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** One tool's row in a record. */
export type TraceTool = 'eval' | 'set' | 'get' | 'record_question' | 'record_analyse' | 'record_answer'

/** A trace row: what was called, whether it worked, and the content that tool stores. */
export interface TraceRow {
  readonly seq: number
  readonly at: number
  readonly tool: TraceTool
  readonly ok: boolean
  readonly content: Record<string, unknown>
}

/** The index row: one record's identity, question and span. */
export interface RecordIndexRow {
  readonly id: string
  readonly question: string
  readonly openedAt: number
  readonly answeredAt: number | null
}

function parseJsonLines<T>(text: string): T[] {
  const rows: T[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      rows.push(JSON.parse(trimmed) as T)
    } catch {
      // A torn last line (a crash mid-write) is dropped: the record keeps every row that parsed.
    }
  }
  return rows
}

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/** The record files under one home: record-index.jsonl and records/<id>.jsonl. */
export class RecordStore {
  readonly indexPath: string
  readonly recordsDir: string

  constructor(readonly home: string) {
    this.indexPath = join(home, 'record-index.jsonl')
    this.recordsDir = join(home, 'records')
  }

  recordPath(id: string): string {
    return join(this.recordsDir, `${id}.jsonl`)
  }

  readIndex(): RecordIndexRow[] {
    return parseJsonLines<RecordIndexRow>(readText(this.indexPath))
  }

  /** Replace the index with these rows (one per record), atomically. */
  writeIndex(rows: readonly RecordIndexRow[]): void {
    mkdirSync(this.home, { recursive: true })
    const temporary = `${this.indexPath}.tmp`
    writeFileSync(temporary, rows.map((row) => `${JSON.stringify(row)}\n`).join(''), 'utf8')
    renameSync(temporary, this.indexPath)
  }

  readRows(id: string): TraceRow[] {
    return parseJsonLines<TraceRow>(readText(this.recordPath(id)))
  }

  appendRow(id: string, row: TraceRow): void {
    mkdirSync(this.recordsDir, { recursive: true })
    appendFileSync(this.recordPath(id), `${JSON.stringify(row)}\n`, 'utf8')
  }

  hasRecord(id: string): boolean {
    return readText(this.recordPath(id)).length > 0
  }

  /** Remove one record: its trace file and its index row. */
  deleteRecord(id: string): void {
    rmSync(this.recordPath(id), { force: true })
    this.writeIndex(this.readIndex().filter((row) => row.id !== id))
  }
}
