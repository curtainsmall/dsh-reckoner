/**
 * Reckoner record detail: one record's trace as a human timeline.
 *
 * The trace body is the process itself — every row carries its input and
 * output. The detail view renders rows in order with typed values shown in a
 * human form (units and prefixes), groups consecutive condition sets and
 * consecutive failed attempts into collapsible sections, highlights failures,
 * and links slot references back to the set row that created the slot.
 * Read-only: fetched from GET /api/dsh-reckoner/records/<id>.
 */
import { useEffect, useState } from 'react'
import { t, useAppLocale } from './locales.ts'
import { IconChevronLeft, IconMarkdown, IconTex } from './icons.tsx'
import { displayValue } from './ui.tsx'
import { TraceTool } from '../engine/trace-tools.ts'
import { ValueTag } from '../engine/value.ts'
import { ArticleFormat } from '../generate.ts'
import { useGenState } from './generation.ts'
import { GenerationSetupDialog } from './generation-ui.tsx'
import { usePanelShowAll } from './settings.tsx'

const BODY_ENDPOINT = '/api/dsh-reckoner/records/'
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

/** The marker flavours the panel draws: one per record tool, plus the refused-call flavour. */
enum MarkerKind {
  Start = 'start',
  Message = 'message',
  End = 'end',
  DuplicateStart = 'duplicate-start',
  DuplicateEnd = 'duplicate-end',
  None = '',
}

/** One trace row as the view reads it: the tool's own fields are lifted onto the row. */
interface TraceRow {
  seq: number
  /** The wire tool name; an unknown one cannot be a marker, so it is kept as a plain string. */
  tool: string
  ok: boolean
  at: number
  /** The flavour iewRow derived from the tool name and its outcome. */
  kind?: MarkerKind
  [key: string]: unknown
}

/** One trace row as the engine serves it: the tool's own fields live inside `content`. */
interface WireRow {
  seq: number
  tool: string
  ok: boolean
  at: number
  content: Record<string, unknown>
}

interface RecordBody {
  id: string
  version: number
  title: string
  openedAt: number
  endedAt: number | null
  rows: TraceRow[]
}

/** The record body as the endpoint serves it, before its rows are normalised. */
interface WireRecordBody {
  id: string
  version: number
  title: string
  openedAt: number
  endedAt: number | null
  rows: WireRow[]
}

/** The keys of an `eval` row's `vars`: exactly the slots the formula read, in first-use order. */
function readSlotNames(vars: unknown): string[] {
  if (vars === null || typeof vars !== 'object') return []
  return Object.keys(vars as Record<string, unknown>)
}

/* ── Wire → view normalisation ────────────────────────────────────────────── */

/**
 * The marker kind of a row, '' for a non-marker: the tool names the kind, and
 * a failed marker is the duplicate/failure flavour of the same marker.
 */
function markerKind(tool: string, ok: boolean): MarkerKind {
  if (tool === TraceTool.Start) return ok ? MarkerKind.Start : MarkerKind.DuplicateStart
  if (tool === TraceTool.Message) return MarkerKind.Message
  if (tool === TraceTool.End) return ok ? MarkerKind.End : MarkerKind.DuplicateEnd
  return MarkerKind.None
}

/**
 * A message row whose content is meta information for the writer: the panel
 * hides it by default and "Display all" reveals it.
 */
function isHiddenMessage(row: TraceRow): boolean {
  return row.tool === TraceTool.Message && row.hide === true
}

/**
 * One wire row as the view reads it: `content` is flattened onto the row, plus
 * the two derived fields - the marker `kind`, and `deleted` for a set row whose
 * value is null (the slot was removed).
 */
function viewRow(row: WireRow): TraceRow {
  const content: Record<string, unknown> = row.content ?? {}
  return {
    ...row,
    ...content,
    kind: markerKind(row.tool, row.ok),
    deleted: row.tool === TraceTool.Set && content[ValueTag.Num] === null,
  }
}

/* ── JSON tree display ────────────────────────────────────────────────────── */

/** A tagged scalar (a real or a complex, with or without its `dim`) is a leaf, shown as text. */
function isTaggedScalar(v: Record<string, unknown>): boolean {
  return typeof v['num'] === 'number'
    || typeof v['re'] === 'number'
    || typeof v['im'] === 'number'
    || typeof v['mag'] === 'number'
    || typeof v['ang'] === 'number'
}

/** Containers (tagged arrays/objects and plain JSON arrays/objects) render as a tree; scalars as text. */
function isExpandable(value: unknown): boolean {
  return containerKind(value) !== null
}

/** Container kind used by the tree (objects show {…}, arrays show […]). */
type TreeKind = 'object' | 'array' | null

function containerKind(value: unknown): TreeKind {
  if (Array.isArray(value)) return 'array'
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (Array.isArray(v['array'])) return 'array'
  if (typeof v['object'] === 'object' && v['object'] !== null && !Array.isArray(v['object'])) return 'object'
  if (isTaggedScalar(v)) return null
  return 'object' // plain JSON object
}

const TREE_INDENT = 18
const TRIANGLE_W = 16

/** Child rows of a container (tagged or plain): objects key their entries, arrays index their items. */
function childrenOf(value: unknown): Array<{ label?: string; value: unknown }> {
  const children: Array<{ label?: string; value: unknown }> = []
  if (Array.isArray(value)) {
    value.forEach((item, index) => children.push({ label: String(index), value: item }))
    return children
  }
  const v = value as Record<string, unknown>
  if (Array.isArray(v['array'])) {
    ;(v['array'] as unknown[]).forEach((item, index) => children.push({ label: String(index), value: item }))
    return children
  }
  if (typeof v['object'] === 'object' && v['object'] !== null && !Array.isArray(v['object'])) {
    for (const [key, field] of Object.entries(v['object'] as Record<string, unknown>)) children.push({ label: key, value: field })
    return children
  }
  for (const [key, field] of Object.entries(v)) children.push({ label: key, value: field })
  return children
}

/**
 * JSON tree row: a disclosure triangle at the start of the row, then the
 * indented key and the value. Container values collapse to a placeholder
 * ({ … } / [ … ]) until expanded. An UNLABELED root object is stripped —
 * its fields become the top-level rows (no wrapper row). Each visible row
 * carries a zebra band that alternates with its siblings, continuing
 * opposite below any expanded container.
 */
function RowNode({ label, value, banded = false }: { label?: string; value: unknown; banded?: boolean }): React.JSX.Element {
  if (label === undefined && containerKind(value) === 'object') {
    // Stripped root: no container row, its fields become top-level rows with a fresh zebra.
    return (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', boxSizing: 'border-box' }}>
        {childrenOf(value).map((child, index) => (
          <RowNodeImpl key={child.label ?? index} label={child.label} value={child.value} depth={0} banded={isZebra(index)} />
        ))}
      </div>
    )
  }
  return <RowNodeImpl label={label} value={value} depth={0} banded={banded} />
}

function RowNodeImpl({ label, value, depth, banded }: { label?: string; value: unknown; depth: number; banded: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const kind = containerKind(value)
  const keyEl = label !== undefined
    ? <span style={{ color: 'var(--dsw-alias-label-tertiary)', ...codeFont, fontSize: 14, minWidth: 8 }}>{label}</span>
    : null
  const leafPad = depth * TREE_INDENT + TRIANGLE_W + 8
  if (kind === null) {
    return (
      <div style={{
        display: 'flex',
        gap: 8,
        alignItems: 'baseline',
        fontSize: 15,
        paddingLeft: leafPad,
        width: '100%',
        boxSizing: 'border-box',
        ...(banded ? zebraRow : {}),
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
          fontSize: 15,
          cursor: 'pointer',
          paddingLeft: depth * TREE_INDENT,
          width: '100%',
          boxSizing: 'border-box',
          ...(banded ? zebraRow : {}),
        }}
      >
        <span aria-hidden="true" style={{ display: 'inline-block', width: TRIANGLE_W, textAlign: 'center', fontSize: 13, color: 'var(--dsw-alias-label-secondary)', flex: 'none' }}>
          {open ? '▾' : '▸'}
        </span>
        {keyEl}
        <span style={{ color: 'var(--dsw-alias-label-tertiary)', ...codeFont, fontSize: 14.5 }}>{placeholder}</span>
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', boxSizing: 'border-box' }}>
          {children.map((child, index) => (
            <RowNodeImpl key={child.label ?? index} label={child.label} value={child.value} depth={depth + 1} banded={childZebra(index, banded)} />
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
  | { kind: 'eval'; row: TraceRow }
  | { kind: 'search'; row: TraceRow }
  | { kind: 'event'; row: TraceRow }

/**
 * The three marker tools: their rows are the record's own narrative, so each
 * one stands alone instead of joining a writes/reads/failures run.
 */
const MARKER_TOOLS: readonly string[] = [TraceTool.Start, TraceTool.Message, TraceTool.End]

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
    else if (first.tool === 'eval') items.push({ kind: 'eval', row: first })
    else items.push({ kind: 'event', row: first })
    run = []
  }
  for (const row of rows) {
    if (MARKER_TOOLS.includes(row.tool)) {
      flush()
      items.push({ kind: 'marker', row })
      continue
    }
    // A lookup stands alone: it is neither a write nor a failure run, and a
    // refused or unanswered lookup still tells its own story.
    if (row.tool === TraceTool.Search) {
      flush()
      items.push({ kind: 'search', row })
      continue
    }
    const runKey = (row.ok && (row.tool === TraceTool.Set || row.tool === TraceTool.Get)) ? row.tool : !row.ok ? 'fail' : null
    const currentKey = run.length > 0 ? (run[0]!.ok ? run[0]!.tool : 'fail') : null
    if (runKey !== null && runKey === currentKey) run.push(row)
    else {
      flush()
      if (runKey !== null) run.push(row)
      else if (row.tool === TraceTool.Eval && row.ok) items.push({ kind: 'eval', row })
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
  font: '12.5px ui-monospace, monospace',
}

/** Zebra stripe: alternating rows get a soft theme-aware band. */
const zebraRow: React.CSSProperties = {
  background: 'var(--dsw-alias-interactive-bg-hover)',
  borderRadius: 4,
}

/** True for odd rows: the first row of a list stays unbanded, stripes alternate from there. */
function isZebra(index: number): boolean {
  return index % 2 === 1
}

/** Child rows alternate under their container, starting opposite the container's own band. */
function childZebra(index: number, containerBanded: boolean): boolean {
  return index % 2 === 0 ? !containerBanded : containerBanded
}

/* ── The detail view ──────────────────────────────────────────────────────── */

export function RecordDetail({ id, onBack }: { id: string; onBack: () => void }): React.JSX.Element {
  useAppLocale()
  const [record, setRecord] = useState<RecordBody | null>(null)
  const [failed, setFailed] = useState(false)
  const [backHover, setBackHover] = useState(false)
  // "Display all" is the panel's remembered preference: it starts from the settings and every
  // toggle writes the new value back, so the detail opens the way the user left it.
  const { showAll, setShowAll } = usePanelShowAll()

  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const res = await fetch(`${BODY_ENDPOINT}${encodeURIComponent(id)}`)
        if (!res.ok) throw new Error(`record endpoint returned ${res.status}`)
        const body = (await res.json()) as WireRecordBody
        if (!alive) return
        // The one point where wire rows enter the view: content flattened, view fields derived.
        setRecord({ ...body, rows: body.rows.map((row) => viewRow(row)) })
        setFailed(false)
      } catch {
        if (alive) setFailed(true)
      }
    }
    void load()
    // While the record is open (endedAt null) keep polling so a running solve appears live.
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

  // The narrative is markers, writes, reads and one card per eval step. Failed
  // attempts and messages the writer marked as meta stay in the trace but out of
  // the timeline unless "Display all" is on: they are part of the engine's
  // account, not of the solution.
  const visibleRows = showAll ? record.rows : record.rows.filter((row) => row.ok && !isHiddenMessage(row))
  const failedCount = visibleRows.filter((row) => !row.ok).length
  const items = groupRows(visibleRows)

  // Content area = page width minus the actions column layout on the right:
  // column 44 + two 12px gaps + 1px separator = 69px. The toolbar (and the
  // checkbox inside it) right-aligns to that content edge.
  const CONTENT_RIGHT_OFFSET = 69
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
      {/* Toolbar row: fixed, never scrolls; back at the left, show-all at the content edge. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginRight: CONTENT_RIGHT_OFFSET, flex: 'none' }}>
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

      {/* Body: the title card tops the left column, so the separator and the
          actions column start at the title card's top edge. Only the timeline
          below the card scrolls. */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', flex: '1 1 auto', minHeight: 0, marginTop: 10 }}>
        <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Header: record id — the title lives in the timeline's start card. */}
          <div style={rowStyle}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--dsw-alias-label-primary)', wordBreak: 'break-all', ...codeFont }}>{record.id}</div>
            <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>
              <span>{t('rowsCount', { n: visibleRows.length })}</span>
              {failedCount > 0 && <span style={{ color: 'var(--dsw-alias-state-error-primary)' }}>{t('failedCount', { n: failedCount })}</span>}
              {record.endedAt === null
                ? <span style={{ padding: '1px 7px', borderRadius: 999, border: '1px solid var(--dsw-alias-state-warn-primary)', color: 'var(--dsw-alias-state-warn-primary)' }}>{t('incomplete')}</span>
                : <span>{formatTime(record.endedAt)}</span>}
            </div>
          </div>

          {/* Scrollable timeline (only this area scrolls). */}
          <div style={{
            flex: '1 1 auto',
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            overflowY: 'auto',
            paddingRight: 4,
          }}>
            {items.map((item) => <TimelineItem key={itemKey(item)} item={item} />)}
          </div>
        </div>

        {/* Separator between the timeline and the article actions column: tops at the title card edge. */}
        <div aria-hidden="true" style={{ flex: 'none', width: 1, alignSelf: 'stretch', background: 'var(--dsw-alias-border-l2)' }} />

        {/* Article generation column. */}
        <ArticleActions body={record} />
      </div>
    </div>
  )
}

/** Right-hand column of the record detail: article generation actions (Markdown and LaTeX). */
function ArticleActions({ body }: { body: RecordBody }): React.JSX.Element {
  const [hovered, setHovered] = useState<string | null>(null)
  const [setupFormat, setSetupFormat] = useState<ArticleFormat | null>(null)
  const { progress: genProgress } = useGenState()
  const genRunning = genProgress?.status === 'running'

  const action = (key: string, label: string, icon: React.ReactNode, format: ArticleFormat): React.JSX.Element => (
    <button
      key={key}
      type="button"
      title={label}
      aria-label={label}
      disabled={genRunning}
      onClick={() => setSetupFormat(format)}
      onMouseEnter={() => setHovered(key)}
      onMouseLeave={() => setHovered(null)}
      style={{
        width: 44,
        height: 44,
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: hovered === key ? 'var(--dsw-alias-interactive-bg-hover)' : 'none',
        color: 'var(--dsw-alias-label-primary)',
        cursor: genRunning ? 'default' : 'pointer',
        opacity: genRunning ? 0.45 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {icon}
    </button>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 'none' }}>
      {action('articleGenerateMarkdown', t('articleGenerateMarkdown'), <IconMarkdown size={24} />, ArticleFormat.Markdown)}
      {action('articleGenerateTex', t('articleGenerateTex'), <IconTex size={28} />, ArticleFormat.Latex)}
      {setupFormat !== null && (
        <GenerationSetupDialog
          open
          format={setupFormat}
          recordId={body.id}
          onClose={() => setSetupFormat(null)}
        />
      )}
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
    case 'eval':
      return <EvalRow row={item.row} />
    case 'search':
      return <SearchRow row={item.row} />
    case 'event':
      return <EventRow row={item.row} />
  }
}

/* ── Marker rows: start / message / end ───────────────────────────────────── */

/** Marker label for a row's derived `kind` (see markerKind): start/message/end, or a duplicate flavour. */
function markerLabel(kind: MarkerKind): string {
  switch (kind) {
    case MarkerKind.Start: return t('markerStart')
    case MarkerKind.Message: return t('markerMessage')
    case MarkerKind.End: return t('markerEnd')
    case MarkerKind.DuplicateStart: return t('markerDuplicateStart')
    case MarkerKind.DuplicateEnd: return t('markerDuplicateEnd')
    default: return kind
  }
}

function MarkerRow({ row }: { row: TraceRow }): React.JSX.Element {
  const kind = row.kind ?? MarkerKind.None
  const accent = !row.ok
    ? 'var(--dsw-alias-state-error-primary)'
    : kind === 'end'
      ? 'var(--dsw-alias-state-success-primary)'
      : kind === 'start'
        ? 'var(--dsw-alias-state-business-primary)'
        : 'var(--dsw-alias-label-tertiary)'
  // The marker's own text: a message / closing carries `text`, the start row carries the title.
  const body = typeof row.text === 'string' && row.text.length > 0
    ? row.text
    : typeof row.title === 'string' ? row.title : ''
  return (
    <div style={{ ...rowStyle, borderLeft: `3px solid ${accent}`, paddingLeft: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {markerLabel(kind)}
      </div>
      {body.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 14.5, color: 'var(--dsw-alias-label-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{body}</div>
      )}
      {typeof row.error === 'string' && (
        <div style={{ marginTop: 6, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.5, wordBreak: 'break-word' }}>{row.error}</div>
      )}
    </div>
  )
}

/* ── Writes group (set rows) ──────────────────────────────────────────────── */

function WritesGroup({ rows }: { rows: TraceRow[] }): React.JSX.Element {
  return (
    <div style={{ ...rowStyle, background: 'var(--dsw-alias-bg-layer-1, transparent)' }}>
      <CollapseHeader label={t('writesGroup', { n: rows.length })} defaultOpen>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {rows.map((row, index) => {
            const name = String(row.name)
            if (row.deleted === true) {
              return (
                <div key={row.seq} id={`set-${name}`} style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 8,
                  width: '100%',
                  boxSizing: 'border-box',
                  ...(isZebra(index) ? zebraRow : {}),
                }}>
                  <span style={{ color: 'var(--dsw-alias-label-tertiary)', ...codeFont, fontSize: 14 }}>{name}</span>
                  <span style={{ color: 'var(--dsw-alias-label-tertiary)' }}>{t('deleted')}</span>
                  {typeof row.rev === 'number' && <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 12.5 }}>rev {row.rev}</span>}
                </div>
              )
            }
            return (
              <div key={row.seq} id={`set-${name}`} style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%', boxSizing: 'border-box' }}>
                <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                  <RowNode label={name} value={row.value} banded={isZebra(index)} />
                </div>
                {typeof row.rev === 'number' && <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 12.5, flex: 'none' }}>rev {row.rev}</span>}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {rows.map((row, index) => {
            const name = String(row.name)
            return (
              <div key={row.seq} style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%', boxSizing: 'border-box' }}>
                <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                  <RowNode label={name} value={row.value} banded={isZebra(index)} />
                </div>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {rows.map((row, index) => (
            <div key={row.seq} style={{ fontSize: 14, width: '100%', boxSizing: 'border-box', ...(isZebra(index) ? zebraRow : {}) }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ ...codeFont, color: 'var(--dsw-alias-label-tertiary)' }}>#{row.seq}</span>
                {typeof row.tool === 'string' && <span style={{ ...codeFont, fontSize: 13.5 }}>{row.tool}</span>}
                {typeof row.formula === 'string' && (
                  <span style={{ ...codeFont, fontSize: 13.5, color: 'var(--dsw-alias-label-secondary)', wordBreak: 'break-all' }}>{row.formula}</span>
                )}
                <span style={{ padding: '0 6px', borderRadius: 999, border: '1px solid var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)', fontSize: 12 }}>
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

/* ── Eval card: the formula the model wrote, its substituted values, result ── */

/**
 * A successful `eval` renders as its own card titled like the writes/reads
 * groups. Collapsed, the summary shows the localized "eval" title followed by
 * the formula; expanded, the body opens with the formula and the target slot,
 * then the slot values it substituted and the result.
 */
function EvalRow({ row }: { row: TraceRow }): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const formula = typeof row.formula === 'string' ? row.formula : ''
  const vars = (row.vars ?? {}) as Record<string, unknown>
  const refs = readSlotNames(row.vars)
  const target = typeof row.target === 'string' ? row.target : null
  return (
    <div style={{ ...rowStyle, background: 'var(--dsw-alias-bg-layer-1, transparent)' }}>
      <details open={open} style={{ fontSize: 14.5 }}>
        <summary
          onClick={(event) => { event.preventDefault(); setOpen(!open) }}
          style={{ cursor: 'pointer', color: 'var(--dsw-alias-label-primary)', fontWeight: 600, marginBottom: 6 }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span>{t('evalLabel')}</span>
            {!open && (
              <span style={{ fontWeight: 400, color: 'var(--dsw-alias-label-secondary)', ...codeFont, fontSize: 13.5, wordBreak: 'break-all' }}>{formula}</span>
            )}
          </span>
        </summary>
        {open && (
          <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <MetaLine label={t('evalFormula')} value={formula} banded={false} />
            {target !== null
              ? (
                <MetaLine label={t('evalTarget')} value={target} banded={false}>
                  {typeof row.rev === 'number' && <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 12.5 }}>rev {row.rev}</span>}
                </MetaLine>
              )
              : <MetaLine label={t('evalTarget')} value={t('evalNoTarget')} banded={false} />}
            {Object.entries(vars).map(([name, value], index) => (
              <RowNode key={name} label={`@${name}`} value={value} banded={isZebra(index)} />
            ))}
            {refs.length > 0 && (
              <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {refs.map((name) => (
                  <button
                    key={name}
                    type="button"
                    title={t('jumpToSet', { name })}
                    onClick={() => document.getElementById(`set-${name}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                    style={{ ...codeFont, padding: '1px 8px', borderRadius: 999, border: '1px solid var(--dsw-alias-label-tertiary)', background: 'none', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', fontSize: 12.5 }}
                  >
                    @{name}
                  </button>
                ))}
              </div>
            )}
            {row.result !== undefined && row.result !== null && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-tertiary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{t('evalResult')}</span>
                <RowNode value={row.result} />
              </div>
            )}
          </div>
        )}
      </details>
    </div>
  )
}

/* ── Search rows (the reckoner-with-search lookup) ────────────────────────── */

/** One source as the record kept it. */
interface SearchSourceView {
  url: string
  title?: string
  publishedAt?: string
}

/** One lookup row's fields, read defensively: a row written by another build may carry anything. */
function searchView(row: TraceRow): {
  question: string
  answer: string
  outcome: string
  tier: string
  error: string
  sources: SearchSourceView[]
} {
  const synthesis =
    typeof row.synthesis === 'object' && row.synthesis !== null ? (row.synthesis as Record<string, unknown>) : {}
  const sources: SearchSourceView[] = []
  for (const entry of Array.isArray(row.used) ? row.used : []) {
    if (typeof entry !== 'object' || entry === null) continue
    const bag = entry as Record<string, unknown>
    if (typeof bag['url'] !== 'string') continue
    sources.push({
      url: bag['url'],
      ...(typeof bag['title'] === 'string' ? { title: bag['title'] } : {}),
      ...(typeof bag['publishedAt'] === 'string' ? { publishedAt: bag['publishedAt'] } : {}),
    })
  }
  return {
    question: typeof row.question === 'string' ? row.question : '',
    answer: typeof synthesis['answer'] === 'string' ? synthesis['answer'] : '',
    outcome: typeof row.outcome === 'string' ? row.outcome : '',
    tier: typeof row.tier === 'string' ? row.tier : '',
    error: typeof row.error === 'string' ? row.error : '',
    sources,
  }
}

/**
 * One lookup: the question the model asked, the answer it received, and - behind
 * a fold, because the reader is the one who needs them - the sources the record
 * kept. A refused or unanswered lookup shows its one sentence in the warn/error
 * accent instead.
 */
function SearchRow({ row }: { row: TraceRow }): React.JSX.Element {
  const view = searchView(row)
  const answered = view.outcome === 'answered' && view.answer.length > 0
  const accent = answered
    ? 'var(--dsw-alias-state-business-primary)'
    : row.ok
      ? 'var(--dsw-alias-state-warn-primary)'
      : 'var(--dsw-alias-state-error-primary)'
  return (
    <div style={{ ...rowStyle, borderLeft: `3px solid ${accent}`, paddingLeft: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        <span>{t('searchLabel')}</span>
        {view.tier === 'open' && <span style={{ color: 'var(--dsw-alias-state-warn-primary)' }}>{t('searchOpenTier')}</span>}
      </div>
      {view.question.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 14.5, color: 'var(--dsw-alias-label-secondary)', fontStyle: 'italic', lineHeight: 1.5 }}>{view.question}</div>
      )}
      {answered && (
        <div style={{ marginTop: 4, fontSize: 14.5, color: 'var(--dsw-alias-label-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{view.answer}</div>
      )}
      {!answered && view.error.length > 0 && (
        <div style={{ marginTop: 6, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.5, wordBreak: 'break-word' }}>{view.error}</div>
      )}
      {view.sources.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <CollapseHeader label={t('searchSources', { n: view.sources.length })}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {view.sources.map((source) => (
                <div key={source.url} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ ...codeFont, fontSize: 13, color: 'var(--dsw-alias-state-business-primary)', wordBreak: 'break-all' }}
                  >
                    {source.title ?? source.url}
                  </a>
                  {source.title !== undefined && (
                    <span style={{ ...codeFont, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', wordBreak: 'break-all' }}>{source.url}</span>
                  )}
                  {source.publishedAt !== undefined && (
                    <span style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>{source.publishedAt}</span>
                  )}
                </div>
              ))}
            </div>
          </CollapseHeader>
        </div>
      )}
    </div>
  )
}

/** One label/value line used for the formula and target rows of an eval card; banded rows get the zebra stripe. */
function MetaLine({ label, value, banded, children }: { label: string; value: string; banded: boolean; children?: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'baseline',
      gap: 8,
      fontSize: 14.5,
      width: '100%',
      boxSizing: 'border-box',
      ...(banded ? zebraRow : {}),
    }}>
      <span style={{ color: 'var(--dsw-alias-label-secondary)', minWidth: 64, fontSize: 13.5 }}>{label}</span>
      <span style={{ color: 'var(--dsw-alias-label-primary)', wordBreak: 'break-word', ...codeFont, fontSize: 13.5 }}>{value}</span>
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
      <span style={{ ...codeFont, color: 'var(--dsw-alias-label-secondary)', fontSize: 14 }}>
        {label}{hasValue ? ` = ${displayValue(row.value)}` : ''}
      </span>
    </div>
  )
}

/* ── Collapsible section (shared by set/conditions, failures and call) ────── */

function CollapseHeader({ label, children, defaultOpen = false }: { label: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }): React.JSX.Element {
  return (
    <details open={defaultOpen} style={{ fontSize: 14.5 }}>
      <summary style={{ cursor: 'pointer', color: 'var(--dsw-alias-label-primary)', fontWeight: 600, marginBottom: 6 }}>{label}</summary>
      {children}
    </details>
  )
}
