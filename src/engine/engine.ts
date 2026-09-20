/**
 * Engine.
 * Global singleton: variable table + record storage + a single open lifecycle.
 * Primitives (set/get/eval) and markers execute through it; every step appends
 * one trace row (with inputs and outputs).
 *
 * The engine does no domain calculation: it parses values, evaluates formulas,
 * checks dimensions and records. It holds no catalog of named formulas — the
 * model supplies the mathematics as a formula, one expression per `eval`.
 */
import { ToolError, ToolErrorCode } from '../errors.ts'
import { log } from '../log.ts'
import { checkDimension } from './dimension.ts'
import { evaluateFormula } from './formula.ts'
import { parseValueString } from './parse-value.ts'
import { printValue } from './print-value.ts'
import { VariableTable } from './table.ts'
import { RecordStore, type IndexRow, type TraceRow } from './storage.ts'
import { kindOf, toCanonical, validateValue, type TypedValue } from './values.ts'

export type Receipt = { ok: true; [key: string]: unknown } | { ok: false; code: ToolErrorCode; error: string }

interface OpenState {
  id: string
  seq: number
  question: string
  openedAt: number
}

export class Engine {
  readonly table = new VariableTable()
  readonly store: RecordStore
  private open: OpenState | null = null

  constructor(home: string) {
    this.store = new RecordStore(home)
  }

  /** Start: clear orphans; if a record with sealedAt null and a body exists, recover it (continue the same file, rebuild the table). */
  start(): void {
    this.store.clearOrphans()
    const row = this.store.readIndex().find((item) => item.sealedAt === null && this.store.hasRecord(item.id))
    if (row === undefined) return
    const rows = this.store.readRows(row.id)
    this.replayInto(rows)
    const lastSeq = rows.reduce((max, item) => Math.max(max, typeof item.seq === 'number' ? item.seq : 0), 0)
    this.open = { id: row.id, seq: lastSeq, question: row.question, openedAt: row.openedAt }
  }

  indexRows(): IndexRow[] {
    return this.store.readIndex()
  }

  isOpen(): boolean {
    return this.open !== null
  }

  openId(): string | null {
    return this.open?.id ?? null
  }

  /**
   * Rebuild engine state from a stored trace: `set` rows are re-applied,
   * everything else is skipped. `eval` rows carry their target, so the table
   * comes back without recomputing anything.
   */
  private replayInto(rows: TraceRow[]): void {
    for (const row of rows) {
      if (row.ok !== true) continue
      if (row.tool === 'set') {
        if (row.deleted === true) this.table.delete(String(row.name))
        else this.table.set(String(row.name), row.value as TypedValue)
        continue
      }
      if (row.tool === 'eval' && typeof row.target === 'string' && row.result !== null && row.result !== undefined) {
        this.table.set(row.target, row.result as TypedValue)
      }
    }
  }

  private nextSeq(): number {
    if (this.open === null) return 1
    this.open.seq += 1
    return this.open.seq
  }

  private requireOpen(): OpenState {
    if (this.open === null) throw new ToolError('no open record — call record_question first', ToolErrorCode.SlotUndeclared)
    return this.open
  }

  private trace(row: Omit<TraceRow, 'seq' | 'at'>): void {
    const open = this.requireOpen()
    const line = { seq: this.nextSeq(), at: Date.now() } as TraceRow
    Object.assign(line, row)
    this.store.appendRow(open.id, line)
  }

  /* ── markers (lifecycle) ─────────────────────────────────────────────── */

  /** record_question: if open exists, seal it (duplicate-start) then open a new one; the variable table is cleared. */
  markerQuestion(text: string): Receipt {
    if (this.open !== null) this.sealDuplicateStart()
    this.table.clear()
    const created = this.store.createRecord(text)
    this.open = { id: created.id, seq: 0, question: text, openedAt: created.openedAt }
    this.trace({ tool: 'marker', kind: 'question', ok: true, text })
    return { ok: true, record: this.open.id }
  }

  markerAnalyse(text: string): Receipt {
    this.requireOpen()
    this.trace({ tool: 'marker', kind: 'analyse', ok: true, text })
    return { ok: true }
  }

  /** record_answer: submit the text and settle; no open record → duplicate-end error record. */
  markerAnswer(text: string): Receipt {
    if (this.open === null) {
      const created = this.store.createRecord('')
      this.open = { id: created.id, seq: 0, question: '', openedAt: created.openedAt }
      this.trace({ tool: 'seal', kind: 'duplicate-end', ok: true })
      this.store.updateIndex(created.id, { sealedAt: Date.now() })
      const id = this.open.id
      this.open = null
      return { ok: true, record: id, error: 'duplicate-end' }
    }
    this.trace({ tool: 'marker', kind: 'answer', ok: true, text })
    const id = this.open.id
    this.store.updateIndex(id, { sealedAt: Date.now() })
    this.open = null
    return { ok: true, record: id }
  }

  private sealDuplicateStart(): void {
    if (this.open === null) return
    this.trace({ tool: 'seal', kind: 'duplicate-start', ok: true })
    this.store.updateIndex(this.open.id, { sealedAt: Date.now() })
    this.open = null
  }

  /* ── set / get / eval ────────────────────────────────────────────────── */

  /**
   * set: parse one value string and write the slot.
   * The parse happens before anything is written — a value that does not parse
   * leaves no trace row and no slot behind.
   */
  opSet(name: string, value: string | null): Receipt {
    try {
      this.validateName(name)
      if (value === null) {
        const deleted = this.table.delete(name)
        this.trace({ tool: 'set', ok: true, name, value: null, deleted })
        return { ok: true, name, deleted }
      }
      const parsed = toCanonical(this.parseValue(value))
      const problem = validateValue(parsed)
      if (problem !== undefined) throw new ToolError(`${problem} — this is an engine bug, the parser produced a malformed value`, ToolErrorCode.Tool)
      const slot = this.table.set(name, parsed)
      this.trace({ tool: 'set', ok: true, name, value: parsed, rev: slot.rev })
      return { ok: true, name, rev: slot.rev, value: this.printValue(parsed) }
    } catch (error) {
      return this.failure('set', error)
    }
  }

  /** get: read one slot and print it in the requested format (default: SI). */
  opGet(name: string, format?: string): Receipt {
    try {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new ToolError(`slot name "${name}" must match ^[A-Za-z_][A-Za-z0-9_]*$`, ToolErrorCode.ArgsInvalid)
      }
      const slot = this.table.get(name)
      if (slot === undefined) {
        throw new ToolError(
          `slot "${name}" is not declared — only conditions given by the user, or the target of an earlier eval, exist`,
          ToolErrorCode.SlotUndeclared,
        )
      }
      const printed = this.printValue(slot.value, format)
      this.trace({ tool: 'get', ok: true, name, format: format ?? null, value: slot.value })
      return { ok: true, name, format: format ?? 'si', value: printed }
    } catch (error) {
      return this.failure('get', error)
    }
  }

  /**
   * eval: evaluate one formula and, when target is given, write the result there.
   *
   * The formula is a single expression: there is no assignment inside it. `@name`
   * reads a slot, the target parameter writes one. The value is not returned —
   * the model reads it with `get`, and the trace carries the result for the
   * record.
   *
   * The write goes through the same path as `set`: the result's kind must match
   * the kind the slot already pins, and a refusal leaves the slot untouched and
   * records one failed row.
   */
  opEval(formula: string, target: string | null): Receipt {
    try {
      const used = new Map<string, TypedValue>()
      const result = evaluateFormula(formula, { readSlot: (name) => this.table.get(name)?.value, used })
      if (target === null) {
        this.trace({ tool: 'eval', ok: true, formula, target: null, rev: null, vars: Object.fromEntries(used), result })
        return { ok: true, target: null, rev: null }
      }
      this.validateName(target)
      const existing = this.table.get(target)
      if (existing !== undefined) {
        // The dimensions say why: "expected voltage (kg·m²·s⁻³·A⁻¹), got current".
        const derived = kindOf(result)
        const pinned = kindOf(existing.value)
        if (derived !== undefined && pinned !== undefined) {
          const problem = checkDimension(derived, pinned)
          if (problem !== undefined) throw new ToolError(problem, ToolErrorCode.DimMismatch)
        }
      }
      const slot = this.table.set(target, result)
      this.trace({ tool: 'eval', ok: true, formula, target, rev: slot.rev, vars: Object.fromEntries(used), result })
      return { ok: true, target, rev: slot.rev }
    } catch (error) {
      return this.failure('eval', error)
    }
  }

  /** Parse a value string into a canonical typed value (SI, rect complex). */
  private parseValue(source: string): TypedValue {
    return parseValueString(source)
  }

  /** Print a canonical value; `format` names a unit, prefix+unit, variant or `json`. */
  private printValue(value: TypedValue, format?: string): string {
    return printValue(value, format)
  }

  private validateName(name: string): void {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new ToolError(`slot name "${name}" must match ^[A-Za-z_][A-Za-z0-9_]*$`, ToolErrorCode.ArgsInvalid)
  }

  private failure(tool: string, error: unknown): Receipt {
    const code = error instanceof ToolError ? error.code : ToolErrorCode.Tool
    const message = error instanceof Error ? error.message : String(error)
    // Run-time diagnostics only: the trace row below stays the authoritative account of the failure.
    log.warn('engine op failed', { tool, code, error: message })
    if (this.open !== null) {
      this.trace({ tool, ok: false, code, error: message })
    }
    return { ok: false, code, error: message }
  }
}
