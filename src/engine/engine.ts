/**
 * The engine shell: the slot table, the unclosed record and the six
 * operations the tools call. Every operation returns a receipt - success
 * carries the stored fact, failure carries `{ ok: false, code, error }` - and
 * nothing is written to a slot when an operation fails. The engine holds no
 * domain knowledge: the formula comes from the caller.
 *
 * The slot table lives exactly as long as the record is open: `record_end`
 * clears it, so a non-empty table means an unclosed record exists.
 */
import { EngineErrorCode, fail, isEngineError } from '../errors.ts'
import { describe } from './describe.ts'
import { evaluateFormula, type SlotAccess } from './formula-eval.ts'
import { parseFormula } from './formula-parser.ts'
import { requireIdentifier } from './identifier.ts'
import { RECORD_VERSION, RecordStore, type RecordSummary, type TraceRow } from './record.ts'
import { TraceTool } from './trace-tools.ts'
import { type DimSpec, parseDim } from './si-vector.ts'
import {
  assertIntegralValue,
  assertValueDim,
  mentionDim,
  parseSetValue,
  renderValue,
  storedDimSpelling,
  type Value,
} from './value.ts'

/** The JSON shape every operation answers with. */
export type Receipt = Record<string, unknown>

export interface EngineOptions {
  /** The clock; injected so a record's timestamps and identifier are reproducible in tests. */
  readonly now?: () => number
}

interface SlotEntry {
  readonly value: Value
  readonly rev: number
}

/** The one unclosed record: its identity in memory, its rows in the unclosed file. */
interface OpenRecord {
  readonly id: string
  readonly title: string
  readonly openedAt: number
  seq: number
}

/** What the list endpoint reports: the closed records, the unclosed one, and the identifiers that cannot be read. */
export interface RecordListing {
  readonly rows: RecordSummary[]
  readonly open: { id: string; title: string; openedAt: number } | null
  /** Records no build can show (no header line, or a version below the current one); the count is its length. */
  readonly unknownIds: string[]
}

export interface GetOptions {
  readonly form?: unknown
  readonly digits?: unknown
  readonly dim?: unknown
}

/** The title, start and end a record's rows carry. */
function summarizeRows(rows: readonly TraceRow[]): { title: string; openedAt: number; endedAt: number } | null {
  const start = rows.find((row) => row.ok && row.tool === TraceTool.Start)
  const title = start?.content['title']
  if (start === undefined || typeof title !== 'string') return null
  const end = [...rows].reverse().find((row) => row.ok && row.tool === TraceTool.End)
  const last = rows[rows.length - 1]
  return { title, openedAt: start.at, endedAt: end?.at ?? last?.at ?? start.at }
}

export class Engine {
  readonly store: RecordStore
  private readonly now: () => number
  private readonly slots = new Map<string, SlotEntry>()
  private open: OpenRecord | null = null
  private roster: { mtime: number; rows: RecordSummary[]; unknownIds: string[] } | null = null

  constructor(readonly home: string, options: EngineOptions = {}) {
    this.store = new RecordStore(home)
    this.now = options.now ?? (() => Date.now())
  }

  /**
   * Resume the unclosed record, if one was left behind: an unreadable or older
   * one is discarded, otherwise its `set` and `eval` rows are replayed in order
   * so the slot table matches the trace already on disk.
   */
  start(): void {
    this.slots.clear()
    this.open = null
    const file = this.store.readOpen()
    if (file === null) return
    if (file.header === null || file.header.version < RECORD_VERSION) {
      this.store.discardOpen()
      return
    }
    const start = file.rows.find((row) => row.ok && row.tool === TraceTool.Start)
    const title = start?.content['title']
    const id = start?.content['record']
    if (start === undefined || typeof title !== 'string' || typeof id !== 'string') {
      this.store.discardOpen()
      return
    }
    this.open = { id, title, openedAt: start.at, seq: file.rows[file.rows.length - 1]?.seq ?? start.seq }
    for (const row of file.rows) {
      if (!row.ok) continue
      try {
        if (row.tool === TraceTool.Set) this.replaySet(row)
        if (row.tool === TraceTool.Eval) this.replayEval(row)
      } catch {
        // A row that no longer parses is skipped: recovery must never keep the plugin from mounting.
      }
    }
  }

  private replaySet(row: TraceRow): void {
    const name = row.content['name']
    if (typeof name !== 'string') return
    const value = row.content['value']
    if (value === null) {
      this.slots.delete(name)
      return
    }
    this.write(name, parseSetValue(value, `the stored value of "${name}"`))
  }

  private replayEval(row: TraceRow): void {
    const target = row.content['target']
    const result = row.content['result']
    if (typeof target !== 'string' || result === null || result === undefined) return
    this.write(target, parseSetValue(result, `the stored result of "${target}"`))
  }

  /** The list: closed records newest first, the unclosed record, and the identifiers that cannot be read. */
  listRecords(): RecordListing {
    const mtime = this.store.recordsDirMtime()
    if (this.roster === null || this.roster.mtime !== mtime) {
      const rows: RecordSummary[] = []
      const unknownIds: string[] = []
      for (const id of this.store.listRecordIds()) {
        const file = this.store.readRecord(id)
        if (file === null) continue
        const summary = file.header === null || file.header.version < RECORD_VERSION ? null : summarizeRows(file.rows)
        if (summary === null) {
          unknownIds.push(id)
          continue
        }
        rows.push({ id, version: file.header!.version, ...summary })
      }
      this.roster = { mtime, rows, unknownIds }
    }
    return {
      rows: this.roster.rows,
      open: this.open === null ? null : { id: this.open.id, title: this.open.title, openedAt: this.open.openedAt },
      unknownIds: this.roster.unknownIds,
    }
  }

  /** One record's rows, the unclosed one included; null when it does not exist or is unreadable. */
  readRecordRows(id: string): { version: number; rows: TraceRow[] } | null {
    const file = this.open?.id === id ? this.store.readOpen() : this.store.readRecord(id)
    if (file === null || file.header === null || file.header.version < RECORD_VERSION) return null
    return { version: file.header.version, rows: file.rows }
  }

  /** The title, start and end of one record, for the detail endpoint. */
  summarize(id: string): { title: string; openedAt: number; endedAt: number } | null {
    const rows = this.readRecordRows(id)
    return rows === null ? null : summarizeRows(rows.rows)
  }

  openRecordId(): string | null {
    return this.open?.id ?? null
  }

  deleteRecord(id: string): void {
    this.store.deleteRecord(id)
    this.roster = null
  }

  opSet(name: unknown, value: unknown): Receipt {
    return this.run(TraceTool.Set, () => {
      this.requireOpenRecord()
      const slotName = requireIdentifier(name, 'the set name')
      if (value === null) {
        this.slots.delete(slotName)
        this.appendRow(TraceTool.Set, true, { name: slotName, value: null })
        return { ok: true, name: slotName, rev: null, value: null }
      }
      const parsed = parseSetValue(value)
      const rev = this.write(slotName, parsed)
      const stored = renderValue(parsed, { spellDim: storedDimSpelling })
      this.appendRow(TraceTool.Set, true, { name: slotName, value: stored })
      return { ok: true, name: slotName, rev, value: stored }
    })
  }

  opGet(name: unknown, options: GetOptions = {}): Receipt {
    return this.run(TraceTool.Get, () => {
      this.requireOpenRecord()
      const slotName = requireIdentifier(name, 'the get name')
      const entry = this.slots.get(slotName)
      if (entry === undefined) {
        fail(
          EngineErrorCode.SlotNotFound,
          `the slot "${slotName}" does not exist yet; declare it with set {name:"${slotName}", value:{num:..., dim:...}} before reading it.`,
        )
      }
      const form = readForm(options.form)
      const digits = readDigits(options.digits)
      const spec: DimSpec | undefined =
        options.dim === undefined || options.dim === null ? undefined : parseDim(options.dim, 'dim')
      if (spec !== undefined) assertValueDim(entry.value, spec, `the slot "${slotName}"`)
      const rendered = renderValue(entry.value, {
        ...(form === undefined ? {} : { form }),
        ...(digits === undefined ? {} : { digits }),
        ...(spec === undefined || spec.name === undefined ? {} : { scale: spec }),
        spellDim: (dim) => (spec === undefined ? mentionDim(dim) : (spec.name ?? spec.vector)),
      })
      this.appendRow(TraceTool.Get, true, { name: slotName, value: rendered })
      return { ok: true, name: slotName, value: rendered }
    })
  }

  opEval(formula: unknown, target: unknown): Receipt {
    return this.run(TraceTool.Eval, () => {
      this.requireOpenRecord()
      if (typeof formula !== 'string') {
        fail(EngineErrorCode.InvalidArgs, `eval takes the formula as a string; got ${describe(formula)}.`)
      }
      if (target === undefined || target === null) {
        fail(
          EngineErrorCode.InvalidArgs,
          'eval needs target: the slot name the result is written into. Read the value back with get - eval does not return it.',
        )
      }
      const targetName = requireIdentifier(target, 'the eval target')
      const vars: Record<string, unknown> = {}
      const slots: SlotAccess = {
        read: (slotName) => this.slots.get(slotName)?.value,
        note: (slotName) => {
          if (vars[slotName] !== undefined) return
          const entry = this.slots.get(slotName)
          if (entry !== undefined) vars[slotName] = renderValue(entry.value, { spellDim: storedDimSpelling })
        },
      }
      const value = evaluateFormula(parseFormula(formula), slots)
      assertIntegralValue(value, `the slot "${targetName}"`)
      const rev = this.write(targetName, value)
      this.appendRow(TraceTool.Eval, true, {
        formula,
        target: targetName,
        rev,
        vars,
        result: renderValue(value, { spellDim: storedDimSpelling }),
      })
      return { ok: true, target: targetName, rev }
    })
  }

  markerStart(title: unknown): Receipt {
    return this.run(TraceTool.Start, () => {
      const recordTitle = readText(title, TraceTool.Start, 'title')
      if (this.open !== null) {
        fail(
          EngineErrorCode.OpenRecordFound,
          `the record "${this.open.id}" is not closed yet; call record_end for it first - a record carries exactly one title.`,
        )
      }
      const id = this.allocateRecordId()
      this.store.beginOpen()
      this.open = { id, title: recordTitle, openedAt: this.now(), seq: 0 }
      const row = this.appendRow(TraceTool.Start, true, { title: recordTitle, record: id })
      // The written row is the record's authoritative start, so the in-memory span matches it.
      if (row !== null) this.open = { id, title: recordTitle, openedAt: row.at, seq: row.seq }
      return { ok: true }
    })
  }

  markerMessage(text: unknown, hide?: unknown): Receipt {
    return this.run(TraceTool.Message, () => {
      this.requireOpenRecord()
      const message = readText(text, TraceTool.Message, 'text')
      if (hide !== undefined && hide !== null && typeof hide !== 'boolean') {
        fail(EngineErrorCode.InvalidArgs, `record_message takes hide as a boolean; got ${describe(hide)}.`)
      }
      this.appendRow(TraceTool.Message, true, hide === true ? { text: message, hide: true } : { text: message })
      return { ok: true }
    })
  }

  markerEnd(text?: unknown): Receipt {
    return this.run(TraceTool.End, () => {
      if (this.open === null) {
        fail(
          EngineErrorCode.OpenRecordNotFound,
          'no record is open, so there is nothing to close; call record_start first.',
        )
      }
      if (text !== undefined && text !== null && typeof text !== 'string') {
        fail(EngineErrorCode.InvalidArgs, `record_end takes the closing text as a string; got ${describe(text)}.`)
      }
      const current = this.open
      const closing = typeof text === 'string' && text.trim().length > 0 ? text : undefined
      this.appendRow(TraceTool.End, true, closing === undefined ? { record: current.id } : { text: closing, record: current.id })
      this.store.closeOpen(current.id)
      this.slots.clear()
      this.open = null
      this.roster = null
      return { ok: true }
    })
  }

  private allocateRecordId(): string {
    const taken = new Set(this.store.listRecordIds())
    if (this.open !== null) taken.add(this.open.id)
    const base = String(this.now())
    let id = base
    let suffix = 2
    while (taken.has(id)) {
      id = `${base}-${suffix}`
      suffix += 1
    }
    return id
  }

  private write(name: string, value: Value): number {
    const rev = (this.slots.get(name)?.rev ?? 0) + 1
    this.slots.set(name, { value, rev })
    return rev
  }

  private requireOpenRecord(): void {
    if (this.open !== null) return
    fail(
      EngineErrorCode.OpenRecordNotFound,
      'no record is open: call record_start first. It opens a record, and set / get / eval are refused until a record is open.',
    )
  }

  private run(tool: TraceTool, body: () => Receipt): Receipt {
    try {
      return body()
    } catch (error) {
      const code = isEngineError(error) ? error.code : EngineErrorCode.UnknownError
      const message = isEngineError(error)
        ? error.message
        : `internal error: ${error instanceof Error ? error.message : String(error)}`
      this.appendRow(tool, false, { code, error: message })
      return { ok: false, code, error: message }
    }
  }

  /** Append one row to the unclosed record; returns it, or null when no record is open. */
  private appendRow(tool: TraceTool, ok: boolean, content: Record<string, unknown>): TraceRow | null {
    const record = this.open
    if (record === null) return null
    record.seq += 1
    const row: TraceRow = { seq: record.seq, at: this.now(), tool, ok, content }
    try {
      this.store.appendOpenRow(row)
    } catch {
      // A trace that cannot be written must not turn a successful call into a failure.
    }
    return row
  }
}

/** A non-empty text argument; `record_start`'s title and `record_message`'s text share the rule. */
function readText(input: unknown, tool: TraceTool, field: string): string {
  if (typeof input !== 'string' || input.trim().length === 0) {
    fail(EngineErrorCode.InvalidArgs, `${tool} takes a non-empty ${field} string; got ${describe(input)}.`)
  }
  return input
}

function readForm(input: unknown): 'rect' | 'polar' | undefined {
  if (input === undefined || input === null) return undefined
  if (input === 'rect' || input === 'polar') return input
  fail(EngineErrorCode.InvalidArgs, `form must be "rect" or "polar"; got ${describe(input)}.`)
}

function readDigits(input: unknown): number | undefined {
  if (input === undefined || input === null) return undefined
  if (typeof input !== 'number' || !Number.isInteger(input) || input < 1) {
    fail(EngineErrorCode.InvalidArgs, `digits must be a positive integer (the number of significant digits to keep); got ${describe(input)}.`)
  }
  return input
}
