/**
 * The engine shell: the slot table, the open record and the six operations
 * the tools call. Every operation returns a receipt - success carries the
 * stored fact, failure carries `{ ok: false, code, error }` - and nothing is
 * written to a slot when an operation fails. The engine holds no domain
 * knowledge: the formula comes from the caller.
 */
import { fail, isEngineError } from '../errors.ts'
import { describe } from './describe.ts'
import { evaluateFormula, type SlotAccess } from './formula-eval.ts'
import { parseFormula } from './formula-parser.ts'
import { requireIdentifier } from './identifier.ts'
import { RecordStore, type RecordIndexRow, type TraceRow, type TraceTool } from './record.ts'
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
  /** The clock; injected so a record's timestamps and id are reproducible in tests. */
  readonly now?: () => number
}

interface SlotEntry {
  readonly value: Value
  readonly rev: number
}

interface OpenRecord {
  readonly id: string
  readonly question: string
  readonly openedAt: number
  seq: number
}

export interface GetOptions {
  readonly form?: unknown
  readonly digits?: unknown
  readonly dim?: unknown
}

export class Engine {
  readonly store: RecordStore
  private readonly now: () => number
  private readonly slots = new Map<string, SlotEntry>()
  private open: OpenRecord | null = null

  constructor(readonly home: string, options: EngineOptions = {}) {
    this.store = new RecordStore(home)
    this.now = options.now ?? (() => Date.now())
  }

  /**
   * Recover the open record: replay its `set` and `eval` rows in order so the
   * slot table matches the trace that is already on disk.
   */
  start(): void {
    const openRow = this.store.readIndex().filter((row) => row.answeredAt === null).pop()
    if (openRow === undefined) {
      this.slots.clear()
      this.open = null
      return
    }
    const rows = this.store.readRows(openRow.id)
    this.slots.clear()
    this.open = {
      id: openRow.id,
      question: openRow.question,
      openedAt: openRow.openedAt,
      seq: rows.length === 0 ? 0 : rows[rows.length - 1]!.seq,
    }
    for (const row of rows) {
      if (!row.ok) continue
      try {
        if (row.tool === 'set') this.replaySet(row)
        if (row.tool === 'eval') this.replayEval(row)
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

  indexRows(): RecordIndexRow[] {
    return this.store.readIndex()
  }

  readRows(id: string): TraceRow[] {
    return this.store.readRows(id)
  }

  openRecordId(): string | null {
    return this.open?.id ?? null
  }

  opSet(name: unknown, value: unknown): Receipt {
    return this.run('set', () => {
      this.requireOpenRecord()
      const slotName = requireIdentifier(name, 'the set name')
      if (value === null) {
        this.slots.delete(slotName)
        this.appendRow('set', true, { name: slotName, value: null })
        return { ok: true, name: slotName, rev: null, value: null }
      }
      const parsed = parseSetValue(value)
      const rev = this.write(slotName, parsed)
      const stored = renderValue(parsed, { spellDim: storedDimSpelling })
      this.appendRow('set', true, { name: slotName, value: stored })
      return { ok: true, name: slotName, rev, value: stored }
    })
  }

  opGet(name: unknown, options: GetOptions = {}): Receipt {
    return this.run('get', () => {
      this.requireOpenRecord()
      const slotName = requireIdentifier(name, 'the get name')
      const entry = this.slots.get(slotName)
      if (entry === undefined) {
        fail(
          'ENGINE_SLOT_UNDECLARED',
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
      this.appendRow('get', true, { name: slotName, value: rendered })
      return { ok: true, name: slotName, value: rendered }
    })
  }

  opEval(formula: unknown, target: unknown): Receipt {
    return this.run('eval', () => {
      this.requireOpenRecord()
      if (typeof formula !== 'string') {
        fail('ENGINE_ARGS_INVALID', `eval takes the formula as a string; got ${describe(formula)}.`)
      }
      if (target === undefined || target === null) {
        fail(
          'ENGINE_ARGS_INVALID',
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
      this.appendRow('eval', true, {
        formula,
        target: targetName,
        rev,
        vars,
        result: renderValue(value, { spellDim: storedDimSpelling }),
      })
      return { ok: true, target: targetName, rev }
    })
  }

  markerQuestion(text: unknown): Receipt {
    return this.run('record_question', () => {
      if (typeof text !== 'string') {
        fail('ENGINE_ARGS_INVALID', `record_question takes the question text as a string; got ${describe(text)}.`)
      }
      if (this.open !== null) {
        fail(
          'ENGINE_RECORD_DUPLICATE',
          `the record "${this.open.id}" is still open; submit record_answer for it first - a record carries exactly one question.`,
        )
      }
      const id = this.allocateRecordId()
      const openedAt = this.now()
      this.slots.clear()
      this.open = { id, question: text, openedAt, seq: 0 }
      this.store.writeIndex([...this.store.readIndex(), { id, question: text, openedAt, answeredAt: null }])
      this.appendRow('record_question', true, { text, record: id })
      return { ok: true }
    })
  }

  markerAnalyse(text: unknown): Receipt {
    return this.run('record_analyse', () => {
      if (typeof text !== 'string') {
        fail('ENGINE_ARGS_INVALID', `record_analyse takes the analysis text as a string; got ${describe(text)}.`)
      }
      this.requireOpenRecord()
      this.appendRow('record_analyse', true, { text })
      return { ok: true }
    })
  }

  markerAnswer(text: unknown): Receipt {
    return this.run('record_answer', () => {
      if (typeof text !== 'string') {
        fail('ENGINE_ARGS_INVALID', `record_answer takes the answer text as a string; got ${describe(text)}.`)
      }
      if (this.open === null) {
        fail(
          'ENGINE_RECORD_DUPLICATE',
          'no record is open, so there is no question to answer; call record_question first.',
        )
      }
      const current = this.open
      this.appendRow('record_answer', true, { text, record: current.id })
      this.sealRecord(current)
      this.open = null
      return { ok: true }
    })
  }

  /** The index row carries the span: the question it opened with and the answer that closed it. */
  private sealRecord(record: OpenRecord): void {
    const rows = this.store.readIndex()
    this.store.writeIndex(
      rows.map((row) =>
        row.id === record.id ? { id: row.id, question: row.question, openedAt: row.openedAt, answeredAt: this.now() } : row,
      ),
    )
  }

  private allocateRecordId(): string {
    const taken = new Set(this.store.readIndex().map((row) => row.id))
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
      'ENGINE_NO_RECORD',
      'no record is open: call record_question first. It opens a record and clears the slot table, and set / get / eval are refused until it is open.',
    )
  }

  private run(tool: TraceTool, body: () => Receipt): Receipt {
    try {
      return body()
    } catch (error) {
      const code = isEngineError(error) ? error.code : 'ENGINE_TOOL'
      const message = isEngineError(error)
        ? error.message
        : `internal error: ${error instanceof Error ? error.message : String(error)}`
      this.appendRow(tool, false, { code, error: message })
      return { ok: false, code, error: message }
    }
  }

  private appendRow(tool: TraceTool, ok: boolean, content: Record<string, unknown>): void {
    const record = this.open
    if (record === null) return
    record.seq += 1
    const row: TraceRow = { seq: record.seq, at: this.now(), tool, ok, content }
    try {
      this.store.appendRow(record.id, row)
    } catch {
      // A trace that cannot be written must not turn a successful call into a failure.
    }
  }
}

function readForm(input: unknown): 'rect' | 'polar' | undefined {
  if (input === undefined || input === null) return undefined
  if (input === 'rect' || input === 'polar') return input
  fail('ENGINE_ARGS_INVALID', `form must be "rect" or "polar"; got ${describe(input)}.`)
}

function readDigits(input: unknown): number | undefined {
  if (input === undefined || input === null) return undefined
  if (typeof input !== 'number' || !Number.isInteger(input) || input < 1) {
    fail('ENGINE_ARGS_INVALID', `digits must be a positive integer (the number of significant digits to keep); got ${describe(input)}.`)
  }
  return input
}
