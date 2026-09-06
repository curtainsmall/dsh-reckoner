/**
 * ElectroLab record detail: one record's trace as a human timeline.
 *
 * The trace body is the process itself — every row carries its input and
 * output. The detail view renders rows in order with typed values shown in a
 * human form (units and prefixes), groups consecutive condition sets and
 * consecutive failed attempts into collapsible sections, highlights failures,
 * and links slot references back to the set row that created the slot.
 * Read-only: fetched from GET /api/dsh-electro-lab/records/<id>.
 */
import { useEffect, useState } from 'react'
import { t, useAppLocale } from './locales.ts'
import { IconChevronLeft } from './icons.tsx'

const BODY_ENDPOINT = '/api/dsh-electro-lab/records/'
const POLL_MS = 5000

/** Back button styling shared with the panel's back-to-session button. */
const backButtonBase: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--dsw-alias-label-tertiary)',
  borderRadius: 6,
  color: 'var(--dsw-alias-label-primary)',
  cursor: 'pointer',
  fontSize: 13,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 8px',
}

interface TraceRow {
  seq: number
  tool: string
  ok: boolean
  at: number
  [key: string]: unknown
}

interface RecordBody {
  id: string
  openedAt: number
  sealedAt: number | null
  question: string
  rows: TraceRow[]
}

/* ── Typed-value display ─────────────────────────────────────────────────── */

const UNIT_BY_KIND: Record<string, string> = {
  resistance: 'Ω', capacitance: 'F', inductance: 'H', voltage: 'V', current: 'A',
  power: 'W', time: 's', frequency: 'Hz', temperature: 'K', angle: 'rad',
  pressure: 'Pa', energy: 'J', length: 'm', mass: 'kg', log: 'dB', none: '',
}

const PREFIX_SYMBOL: Record<string, string> = {
  pico: 'p', nano: 'n', micro: 'µ', milli: 'm', kilo: 'k', mega: 'M', giga: 'G', tera: 'T',
}

const VARIANT_DISPLAY: Record<string, string> = {
  degC: '°C', degF: '°F', deg: '°', bar: 'bar', psi: 'psi', atm: 'atm',
  cal: 'cal', Wh: 'Wh', hp: 'hp', inch: 'in', foot: 'ft', yard: 'yd',
  mile: 'mi', lb: 'lb', oz: 'oz',
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  const abs = Math.abs(n)
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-3)) return n.toExponential(4).replace(/\.?0+e/, 'e')
  return String(Math.round(n * 10000) / 10000)
}

/** Render one typed value as human text. Slot values are returned as "@name" markers for chip styling. */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return String(value)
  const v = value as Record<string, unknown>
  switch (v.type) {
    case 'number': {
      const kind = String(v.kind ?? 'none')
      const unit = UNIT_BY_KIND[kind] ?? ''
      if (v.variant !== undefined) {
        const variantName = String(v.variant)
        return `${fmt(Number(v.value))} ${VARIANT_DISPLAY[variantName] ?? variantName}`
      }
      const prefix = v.prefix === undefined ? '' : PREFIX_SYMBOL[String(v.prefix)] ?? String(v.prefix)
      return `${fmt(Number(v.value))} ${prefix}${unit}`.trim()
    }
    case 'complex': {
      const box = v.value as { re?: number; im?: number; mag?: number; ang?: number }
      const kind = String(v.kind ?? 'none')
      const unit = UNIT_BY_KIND[kind] ?? ''
      if (box.mag !== undefined && box.ang !== undefined) {
        return `${fmt(box.mag)} ∠ ${fmt(box.ang)} rad ${unit}`.trim()
      }
      const re = box.re ?? 0
      const im = box.im ?? 0
      const sign = im < 0 ? '−' : '+'
      return `${fmt(re)} ${sign} j${fmt(Math.abs(im))} ${unit}`.trim()
    }
    case 'string':
      return String(v.value)
    case 'boolean':
      return String(v.value)
    case 'slot':
      return `@${String(v.value)}`
    case 'array':
      return `[ ${(v.value as unknown[]).map((item) => displayValue(item)).join(', ')} ]`
    case 'object':
      return JSON.stringify(v.value)
    default:
      return JSON.stringify(value)
  }
}

/** Collect the distinct slot names referenced anywhere inside an argument value. */
function referencedSlots(value: unknown, into: string[]): void {
  if (value === null || typeof value !== 'object') return
  const v = value as Record<string, unknown>
  if (v.type === 'slot' && typeof v.value === 'string') {
    const name = v.value.split('.')[0] ?? v.value
    if (!into.includes(name)) into.push(name)
    return
  }
  if (v.type === 'array' && Array.isArray(v.value)) {
    for (const item of v.value as unknown[]) referencedSlots(item, into)
    return
  }
  if (v.type === 'object' && typeof v.value === 'object' && v.value !== null) {
    for (const field of Object.values(v.value as Record<string, unknown>)) referencedSlots(field, into)
  }
}

/* ── JSON tree display ────────────────────────────────────────────────────── */

/** Containers (typed or plain arrays/objects) render as a tree; scalars as text. */
function isExpandable(value: unknown): boolean {
  if (Array.isArray(value)) return true
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (v.type === undefined) return true // plain JSON object
  return v.type === 'array' || v.type === 'object'
}

/** Container kind used by the tree (objects show {…}, arrays show […]). */
type TreeKind = 'object' | 'array' | null

function containerKind(value: unknown): TreeKind {
  if (Array.isArray(value)) return 'array'
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (v.type === 'array' && Array.isArray(v.value)) return 'array'
  if (v.type === 'object' && typeof v.value === 'object' && v.value !== null) return 'object'
  if (v.type === undefined) return 'object'
  return null
}

const TREE_INDENT = 18
const TRIANGLE_W = 16

/** Child rows of a container (typed or plain): objects key their entries, arrays index their items. */
function childrenOf(value: unknown): Array<{ label?: string; value: unknown }> {
  const children: Array<{ label?: string; value: unknown }> = []
  if (Array.isArray(value)) {
    value.forEach((item, index) => children.push({ label: String(index), value: item }))
    return children
  }
  const v = value as Record<string, unknown>
  if (v.type === 'array' && Array.isArray(v.value)) {
    ;(v.value as unknown[]).forEach((item, index) => children.push({ label: String(index), value: item }))
    return children
  }
  if (v.type === 'object' && typeof v.value === 'object' && v.value !== null) {
    for (const [key, field] of Object.entries(v.value as Record<string, unknown>)) children.push({ label: key, value: field })
    return children
  }
  for (const [key, field] of Object.entries(v)) children.push({ label: key, value: field })
  return children
}

/**
 * JSON tree row: a disclosure triangle at the start of the row, then the
 * indented key and the value. Container values collapse to a placeholder
 * ({ … } / [ … ]) until expanded. An UNLABELED root object is stripped —
 * its fields become the top-level rows (no wrapper row).
 */
function RowNode({ label, value }: { label?: string; value: unknown }): React.JSX.Element {
  if (label === undefined && containerKind(value) === 'object') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', boxSizing: 'border-box' }}>
        {childrenOf(value).map((child, index) => (
          <RowNodeImpl key={child.label ?? index} label={child.label} value={child.value} depth={0} />
        ))}
      </div>
    )
  }
  return <RowNodeImpl label={label} value={value} depth={0} />
}

function RowNodeImpl({ label, value, depth }: { label?: string; value: unknown; depth: number }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const kind = containerKind(value)
  const keyEl = label !== undefined
    ? <span style={{ color: 'var(--dsw-alias-label-tertiary)', ...codeFont, fontSize: 13, minWidth: 8 }}>{label}</span>
    : null
  const leafPad = depth * TREE_INDENT + TRIANGLE_W + 8
  if (kind === null) {
    return (
      <div style={{
        display: 'flex',
        gap: 8,
        alignItems: 'baseline',
        fontSize: 13.5,
        paddingLeft: leafPad,
        width: '100%',
        boxSizing: 'border-box',
      }}>
        {keyEl}
        <span style={{ wordBreak: 'break-word', color: 'var(--dsw-alias-label-primary)' }}>{displayValue(value)}</span>
      </div>
    )
  }
  const children = childrenOf(value)
  const placeholder = kind === 'object' ? '{ … }' : '[ … ]'
  return (
    <div style={{ width: '100%', boxSizing: 'border-box' }}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpen(!open) } }}
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'baseline',
          fontSize: 13.5,
          cursor: 'pointer',
          paddingLeft: depth * TREE_INDENT,
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <span aria-hidden="true" style={{ display: 'inline-block', width: TRIANGLE_W, textAlign: 'center', fontSize: 12, color: 'var(--dsw-alias-label-secondary)', flex: 'none' }}>
          {open ? '▾' : '▸'}
        </span>
        {keyEl}
        <span style={{ color: 'var(--dsw-alias-label-tertiary)', ...codeFont, fontSize: 13.5 }}>{placeholder}</span>
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', boxSizing: 'border-box' }}>
          {children.map((child, index) => (
            <RowNodeImpl key={child.label ?? index} label={child.label} value={child.value} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Timeline grouping ────────────────────────────────────────────────────── */

type Item =
  | { kind: 'marker'; row: TraceRow }
  | { kind: 'writes'; rows: TraceRow[] }
  | { kind: 'reads'; rows: TraceRow[] }
  | { kind: 'failures'; rows: TraceRow[] }
  | { kind: 'call'; row: TraceRow }
  | { kind: 'event'; row: TraceRow }

/**
 * Fold consecutive ok set rows into a "writes" card, consecutive ok get rows
 * into a "reads" card, and consecutive failures into one section.
 */
function groupRows(rows: TraceRow[]): Item[] {
  const items: Item[] = []
  let run: TraceRow[] = []
  const flush = (): void => {
    if (run.length === 0) return
    const first = run[0]!
    if (first.tool === 'set' && first.ok) items.push({ kind: 'writes', rows: run })
    else if (first.tool === 'get' && first.ok) items.push({ kind: 'reads', rows: run })
    else if (!first.ok) items.push({ kind: 'failures', rows: run })
    else if (first.tool === 'call') items.push({ kind: 'call', row: first })
    else items.push({ kind: 'event', row: first })
    run = []
  }
  for (const row of rows) {
    const runKey = (row.ok && (row.tool === 'set' || row.tool === 'get')) ? row.tool : !row.ok ? 'fail' : null
    const currentKey = run.length > 0 ? (run[0]!.ok ? run[0]!.tool : 'fail') : null
    if (runKey !== null && runKey === currentKey) run.push(row)
    else {
      flush()
      if (runKey !== null) run.push(row)
      else if (row.tool === 'marker') items.push({ kind: 'marker', row })
      else if (row.tool === 'call' && row.ok) items.push({ kind: 'call', row })
      else items.push({ kind: 'event', row })
    }
  }
  flush()
  return items
}

/* ── Row chrome ───────────────────────────────────────────────────────────── */

const rowStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 6,
  border: '1px solid var(--dsw-alias-border-l2)',
}

const codeFont: React.CSSProperties = {
  font: '11px ui-monospace, monospace',
}

/* ── The detail view ──────────────────────────────────────────────────────── */

export function RecordDetail({ id, onBack }: { id: string; onBack: () => void }): React.JSX.Element {
  useAppLocale()
  const [record, setRecord] = useState<RecordBody | null>(null)
  const [failed, setFailed] = useState(false)
  const [backHover, setBackHover] = useState(false)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const res = await fetch(`${BODY_ENDPOINT}${encodeURIComponent(id)}`)
        if (!res.ok) throw new Error(`record endpoint returned ${res.status}`)
        const body = (await res.json()) as RecordBody
        if (!alive) return
        setRecord(body)
        setFailed(false)
      } catch {
        if (alive) setFailed(true)
      }
    }
    void load()
    // While the record is open (sealedAt null) keep polling so a running solve appears live.
    const timer = setInterval(() => {
      void load()
    }, POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [id])

  if (failed && record === null) {
    return (
      <div style={rowStyle}>
        <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>{t('recordUnreachable')}</span>
      </div>
    )
  }
  if (record === null) return <div style={{ minHeight: 120 }} />

  // "Display all" off hides introspection noise (solver_info rows) from the narrative timeline.
  const visibleRows = showAll ? record.rows : record.rows.filter((row) => row.tool !== 'solver_info')
  const failedCount = visibleRows.filter((row) => !row.ok).length
  const items = groupRows(visibleRows)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <button
          type="button"
          aria-label={t('backToRecords')}
          onClick={onBack}
          onMouseEnter={() => setBackHover(true)}
          onMouseLeave={() => setBackHover(false)}
          style={{
            ...backButtonBase,
            background: backHover ? 'var(--dsw-alias-interactive-bg-hover)' : 'none',
            borderColor: backHover ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-tertiary)',
          }}
        >
          <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center' }}><IconChevronLeft size={16} /></span>
          <span style={{ lineHeight: 1 }}>{t('backToRecords')}</span>
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--dsw-alias-label-primary)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showAll}
            onChange={(event) => setShowAll(event.target.checked)}
            style={{ accentColor: 'var(--dsw-alias-state-business-primary)' }}
          />
          {t('displayAll')}
        </label>
      </div>

      {/* Header: question + meta */}
      <div style={rowStyle}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }}>{record.question || record.id}</div>
        <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>
          <span>{t('rowsCount', { n: visibleRows.length })}</span>
          {failedCount > 0 && <span style={{ color: 'var(--dsw-alias-state-error-primary)' }}>{t('failedCount', { n: failedCount })}</span>}
          {record.sealedAt === null
            ? <span style={{ padding: '1px 7px', borderRadius: 999, border: '1px solid var(--dsw-alias-state-warn-primary)', color: 'var(--dsw-alias-state-warn-primary)' }}>{t('incomplete')}</span>
            : <span>{formatTime(record.sealedAt)}</span>}
        </div>
      </div>

      {/* The timeline */}
      {items.map((item) => <TimelineItem key={itemKey(item)} item={item} />)}
    </div>
  )
}

function itemKey(item: Item): string {
  if (item.kind === 'writes' || item.kind === 'reads' || item.kind === 'failures') return `${item.kind}-${item.rows[0]?.seq ?? 0}`
  return `${item.row.tool}-${item.row.seq}`
}

function formatTime(time: number): string {
  return new Date(time).toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function TimelineItem({ item }: { item: Item }): React.JSX.Element {
  switch (item.kind) {
    case 'marker':
      return <MarkerRow row={item.row} />
    case 'writes':
      return <WritesGroup rows={item.rows} />
    case 'reads':
      return <ReadsGroup rows={item.rows} />
    case 'failures':
      return <FailuresGroup rows={item.rows} />
    case 'call':
      return <CallRow row={item.row} />
    case 'event':
      return <EventRow row={item.row} />
  }
}

/* ── Marker rows: question / analyse / answer / seal ──────────────────────── */

function markerLabel(kind: string): string {
  switch (kind) {
    case 'question': return t('markerQuestion')
    case 'analyse': return t('markerAnalyse')
    case 'answer': return t('markerAnswer')
    case 'duplicate-start': return t('markerDuplicateStart')
    case 'duplicate-end': return t('markerDuplicateEnd')
    default: return kind
  }
}

function MarkerRow({ row }: { row: TraceRow }): React.JSX.Element {
  const kind = String(row.kind ?? '')
  const accent = kind === 'answer'
    ? 'var(--dsw-alias-state-success-primary)'
    : kind === 'question'
      ? 'var(--dsw-alias-state-business-primary)'
      : 'var(--dsw-alias-label-tertiary)'
  const isSeal = row.tool === 'seal'
  return (
    <div style={{ ...rowStyle, borderLeft: `3px solid ${accent}`, paddingLeft: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {markerLabel(kind)}
      </div>
      {typeof row.text === 'string' && row.text.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 13, color: 'var(--dsw-alias-label-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{row.text}</div>
      )}
    </div>
  )
}

/* ── Writes group (set rows) ──────────────────────────────────────────────── */

function WritesGroup({ rows }: { rows: TraceRow[] }): React.JSX.Element {
  return (
    <div style={{ ...rowStyle, background: 'var(--dsw-alias-bg-layer-1, transparent)' }}>
      <CollapseHeader label={t('writesGroup', { n: rows.length })} defaultOpen>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rows.map((row) => {
            const name = String(row.name)
            const expandable = !row.deleted && isExpandable(row.value)
            return (
              <div key={row.seq} id={`set-${name}`} style={{ display: 'flex', alignItems: expandable ? 'flex-start' : 'baseline', gap: 8, fontSize: 12.5 }}>
                {!expandable && <span style={{ color: 'var(--dsw-alias-label-secondary)', minWidth: 64, ...codeFont }}>{name}</span>}
                {row.deleted === true
                  ? <span style={{ color: 'var(--dsw-alias-label-tertiary)' }}>{t('deleted')}</span>
                  : expandable
                    ? <div style={{ flex: '1 1 auto', minWidth: 0 }}><RowNode label={name} value={row.value} /></div>
                    : <span style={{ wordBreak: 'break-word', color: 'var(--dsw-alias-label-primary)' }}>{displayValue(row.value)}</span>}
                {typeof row.rev === 'number' && <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 }}>rev {row.rev}</span>}
              </div>
            )
          })}
        </div>
      </CollapseHeader>
    </div>
  )
}

/* ── Reads group (get rows), same card style as writes ────────────────────── */

function ReadsGroup({ rows }: { rows: TraceRow[] }): React.JSX.Element {
  return (
    <div style={{ ...rowStyle, background: 'var(--dsw-alias-bg-layer-1, transparent)' }}>
      <CollapseHeader label={t('readsGroup', { n: rows.length })} defaultOpen>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rows.map((row) => {
            const name = String(row.name)
            const expandable = isExpandable(row.value)
            return (
              <div key={row.seq} style={{ display: 'flex', alignItems: expandable ? 'flex-start' : 'baseline', gap: 8, fontSize: 12.5 }}>
                {!expandable && <span style={{ color: 'var(--dsw-alias-label-secondary)', minWidth: 64, ...codeFont }}>{name}</span>}
                {expandable
                  ? <div style={{ flex: '1 1 auto', minWidth: 0 }}><RowNode label={name} value={row.value} /></div>
                  : <span style={{ wordBreak: 'break-word', color: 'var(--dsw-alias-label-primary)' }}>{displayValue(row.value)}</span>}
              </div>
            )
          })}
        </div>
      </CollapseHeader>
    </div>
  )
}

/* ── Failed attempts group ────────────────────────────────────────────────── */

function FailuresGroup({ rows }: { rows: TraceRow[] }): React.JSX.Element {
  return (
    <div style={{ ...rowStyle, borderColor: 'var(--dsw-alias-state-error-primary)', background: 'var(--dsw-alias-bg-layer-1, transparent)' }}>
      <CollapseHeader label={t('failuresGroup', { n: rows.length })}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((row) => (
            <div key={row.seq} style={{ fontSize: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ ...codeFont, color: 'var(--dsw-alias-label-tertiary)' }}>#{row.seq}</span>
                {typeof row.solver === 'string' && <span style={{ ...codeFont }}>{row.solver}</span>}
                <span style={{ padding: '0 6px', borderRadius: 999, border: '1px solid var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)', fontSize: 11 }}>
                  {String(row.code)}
                </span>
              </div>
              {typeof row.error === 'string' && (
                <div style={{ marginTop: 4, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.5, wordBreak: 'break-word' }}>{row.error}</div>
              )}
            </div>
          ))}
        </div>
      </CollapseHeader>
    </div>
  )
}

/* ── Call card: title in the get/set style, solver/target meta on open ────── */

/**
 * A successful call renders as its own card titled like the writes/reads
 * groups. Collapsed, the summary shows the localized "call" title followed by
 * the solver name; expanded, the body opens with two meta lines — the solver
 * and the target slot — and then the arguments and result.
 */
function CallRow({ row }: { row: TraceRow }): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const args = (row.args ?? {}) as Record<string, unknown>
  const refs: string[] = []
  referencedSlots(row.args, refs)
  const solver = typeof row.solver === 'string' ? row.solver : row.tool
  return (
    <div style={{ ...rowStyle, background: 'var(--dsw-alias-bg-layer-1, transparent)' }}>
      <details open={open} style={{ fontSize: 12.5 }}>
        <summary
          onClick={(event) => { event.preventDefault(); setOpen(!open) }}
          style={{ cursor: 'pointer', color: 'var(--dsw-alias-label-primary)', fontWeight: 600, marginBottom: 6 }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span>{t('callLabel')}</span>
            {!open && (
              <span style={{ fontWeight: 400, color: 'var(--dsw-alias-label-secondary)', ...codeFont }}>{solver}</span>
            )}
          </span>
        </summary>
        {open && (
          <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <MetaLine label={t('callSolver')} value={solver} />
            {typeof row.target === 'string' && (
              <MetaLine label={t('callTarget')} value={row.target}>
                {typeof row.rev === 'number' && <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 }}>rev {row.rev}</span>}
              </MetaLine>
            )}
            {Object.entries(args).map(([name, value]) => (
              <RowNode key={name} label={name} value={value} />
            ))}
            {refs.length > 0 && (
              <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {refs.map((name) => (
                  <button
                    key={name}
                    type="button"
                    title={t('jumpToSet', { name })}
                    onClick={() => document.getElementById(`set-${name}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                    style={{ ...codeFont, padding: '1px 8px', borderRadius: 999, border: '1px solid var(--dsw-alias-label-tertiary)', background: 'none', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', fontSize: 11 }}
                  >
                    @{name}
                  </button>
                ))}
              </div>
            )}
            {row.result !== undefined && row.result !== null && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{t('callResult')}</span>
                <RowNode value={row.result} />
              </div>
            )}
          </div>
        )}
      </details>
    </div>
  )
}

/** One label/value line used for the solver and target rows of a call card. */
function MetaLine({ label, value, children }: { label: string; value: string; children?: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12.5 }}>
      <span style={{ color: 'var(--dsw-alias-label-secondary)', minWidth: 64 }}>{label}</span>
      <span style={{ color: 'var(--dsw-alias-label-primary)', wordBreak: 'break-word', ...codeFont }}>{value}</span>
      {children}
    </div>
  )
}

/* ── Other events (get, set-delete, …) ───────────────────────────────────── */

function EventRow({ row }: { row: TraceRow }): React.JSX.Element {
  const label = `${row.tool}${typeof row.name === 'string' ? ` ${row.name}` : ''}`
  const hasValue = row.value !== undefined && row.value !== null
  if (hasValue && isExpandable(row.value)) {
    return (
      <div style={{ ...rowStyle, padding: '6px 12px' }}>
        <RowNode label={label} value={row.value} />
      </div>
    )
  }
  return (
    <div style={{ ...rowStyle, padding: '6px 12px' }}>
      <span style={{ ...codeFont, color: 'var(--dsw-alias-label-secondary)', fontSize: 12 }}>
        {label}{hasValue ? ` = ${displayValue(row.value)}` : ''}
      </span>
    </div>
  )
}

/* ── Collapsible section (shared by set/conditions, failures and call) ────── */

function CollapseHeader({ label, children, defaultOpen = false }: { label: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }): React.JSX.Element {
  return (
    <details open={defaultOpen} style={{ fontSize: 12.5 }}>
      <summary style={{ cursor: 'pointer', color: 'var(--dsw-alias-label-primary)', fontWeight: 600, marginBottom: 6 }}>{label}</summary>
      {children}
    </details>
  )
}
