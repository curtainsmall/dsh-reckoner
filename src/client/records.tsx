/**
 * Reckoner record list page.
 * The list reads the host's /records-index: the closed records, the one
 * unclosed record (pinned above the list) and a count of unknown records;
 * clicking a row opens the record's trace timeline (record-detail.tsx).
 */
import { useEffect, useState } from 'react'
import { t, useAppLocale } from './locales.ts'
import { Dialog, GhostButton, PrimaryButton } from './ui.tsx'
import { RecordDetail } from './record-detail.tsx'

/* ── record list ─────────────────────────────────────────────────────────── */

/** Index-row mirror (one closed record of the records index). */
interface IndexRow {
  id: string
  title: string
  version: number
  openedAt: number
  endedAt: number
}

/** The one unclosed record, when the engine has one: engine state, rendered as a pinned row. */
interface OpenRow {
  id: string
  title: string
  openedAt: number
}

/** The records index the endpoint serves: closed rows (newest first), the open record, the unreadable ids. */
interface RecordsIndex {
  rows: IndexRow[]
  open: OpenRow | null
  unknownIds?: string[]
  /** Older hosts report the count alone; the line then shows it without offering a delete. */
  unknown?: number
}

/** The red "X unknown records" line: a plain-text button, since clicking it offers to delete them. */
const unknownLineStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  padding: 0,
  border: 'none',
  background: 'none',
  color: 'var(--dsw-alias-state-error-primary)',
  fontSize: 12,
  font: 'inherit',
  textDecoration: 'underline',
  cursor: 'pointer',
}

const INDEX_ENDPOINT = '/api/dsh-reckoner/records-index'
const RECORD_ENDPOINT = '/api/dsh-reckoner/records/'
const POLL_MS = 5000

/** One toolbar control height: every button in the toolbar is boxed to it, so switching modes cannot shift the page. */
const TOOLBAR_CONTROL_HEIGHT = 24

const rowStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 6,
  border: '1px solid var(--dsw-alias-border-l2)',
}

/** Pinned style of the unclosed record: the accent marks it as the engine's live record. */
const openRowStyle: React.CSSProperties = {
  ...rowStyle,
  borderColor: 'var(--dsw-alias-state-business-primary)',
  borderLeft: '3px solid var(--dsw-alias-state-business-primary)',
}

/** Selected row in select mode: the accent border plus a ring and a tinted fill, since there is no checkbox. */
const selectedRowStyle: React.CSSProperties = {
  borderColor: 'var(--dsw-alias-state-business-primary)',
  boxShadow: '0 0 0 1px var(--dsw-alias-state-business-primary)',
  background: 'var(--dsw-alias-interactive-bg-active)',
}

/** One list row as a button: the base row plus the resets a button needs. */
const rowButtonStyle: React.CSSProperties = {
  ...rowStyle,
  textAlign: 'left',
  cursor: 'pointer',
  background: 'none',
  width: '100%',
  font: 'inherit',
  color: 'inherit',
  flex: '1 1 auto',
}

/** One clipped line of row title (the open record and the list rows share it). */
const rowTitleStyle: React.CSSProperties = {
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 13,
  fontWeight: 600,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
  minWidth: 0,
}

/** "Running" marker of the unclosed record. */
const runningBadgeStyle: React.CSSProperties = {
  padding: '1px 7px',
  borderRadius: 999,
  fontSize: 11,
  border: '1px solid var(--dsw-alias-state-warn-primary)',
  color: 'var(--dsw-alias-state-warn-primary)',
  flex: 'none',
}

/** Danger action button (delete …). */
const dangerButtonStyle: React.CSSProperties = {
  padding: '4px 12px',
  borderRadius: 6,
  border: '1px solid var(--dsw-alias-state-error-primary)',
  background: 'none',
  color: 'var(--dsw-alias-state-error-primary)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
}

/** The same button, boxed to one toolbar height so entering select mode cannot reflow the page. */
const toolbarDangerButtonStyle: React.CSSProperties = {
  ...dangerButtonStyle,
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  height: TOOLBAR_CONTROL_HEIGHT,
  padding: '0 12px',
  whiteSpace: 'nowrap',
}

/** Neutral action button (select mode toggle …), boxed like every other toolbar control. */
const modeButtonStyle: React.CSSProperties = {
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  height: TOOLBAR_CONTROL_HEIGHT,
  padding: '0 10px',
  borderRadius: 6,
  border: '1px solid var(--dsw-alias-label-tertiary)',
  background: 'none',
  color: 'var(--dsw-alias-label-primary)',
  cursor: 'pointer',
  fontSize: 12.5,
  fontWeight: 600,
  whiteSpace: 'nowrap',
}
function formatTime(time: number): string {
  return new Date(time).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * The "X unknown records" line. It is clickable (and offers to delete them) only
 * when the host reported their ids: a host built before the ids existed reports a
 * bare count, and then the line still shows the number instead of disappearing.
 */
function UnknownRecordsLine({ ids, count, onDelete }: { ids: string[]; count: number; onDelete: () => void }): React.JSX.Element | null {
  if (count === 0) return null
  const text = t('unknownRecords', { n: count })
  if (ids.length === 0) {
    return <span style={{ ...unknownLineStyle, textDecoration: 'none', cursor: 'default' }}>{text}</span>
  }
  return (
    <button type="button" style={unknownLineStyle} title={t('deleteUnknown')} onClick={onDelete}>
      {text}
    </button>
  )
}

/** Record list page: render from the index (title = the record's title); the open record is pinned above the list; polls every 5s. */
export function RecordsTab(): React.JSX.Element {
  useAppLocale()
  const [rows, setRows] = useState<IndexRow[] | null>(null)
  const [open, setOpen] = useState<OpenRow | null>(null)
  const [unknownIds, setUnknownIds] = useState<string[]>([])
  const [unknownCount, setUnknownCount] = useState(0)
  const [failed, setFailed] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Two list modes: normal (click opens a record) and select (click toggles, the accent border marks it).
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmUnknown, setConfirmUnknown] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)

  /** Enter select mode (fresh selection) or leave it (clear the selection). */
  const switchSelectMode = (next: boolean): void => {
    setSelectMode(next)
    if (!next) setSelected(new Set())
  }

  useEffect(() => {
    if (selectedId !== null) return
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const res = await fetch(INDEX_ENDPOINT)
        if (!res.ok) throw new Error(`records-index endpoint returned ${res.status}`)
        const body = (await res.json()) as RecordsIndex
        if (!alive) return
        setRows(body.rows)
        setOpen(body.open)
        const ids = body.unknownIds ?? []
        setUnknownIds(ids)
        setUnknownCount(ids.length > 0 ? ids.length : (body.unknown ?? 0))
        setFailed(false)
      } catch {
        if (alive) setFailed(true)
      }
    }
    void load()
    const timer = setInterval(() => void load(), POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [selectedId, refreshTick])

  if (selectedId !== null) {
    return <RecordDetail id={selectedId} onBack={() => setSelectedId(null)} />
  }

  if (failed && rows === null) {
    return (
      <div style={rowStyle}>
        <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>{t('unreachable')}</span>
      </div>
    )
  }

  // Newest first: the list shows recency order. The unclosed record is not a
  // row of this list, so it does not count against the empty state.
  const items = [...(rows ?? [])].sort((a, b) => b.openedAt - a.openedAt)
  if (items.length === 0 && open === null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={rowStyle}>
          <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>{t('emptyHint')}</span>
        </div>
        {/* Nothing to show can still mean records exist: the unknown ones can only be counted and deleted. */}
        <UnknownRecordsLine
          ids={unknownIds}
          count={unknownCount}
          onDelete={() => { setDeleteError(null); setConfirmUnknown(true) }}
        />
      </div>
    )
  }

  const allSelected = items.every((row) => selected.has(row.id))
  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleAll = (): void => {
    setSelected((prev) => (allSelected ? new Set() : new Set(items.map((row) => row.id))))
  }
  const closeConfirm = (): void => {
    if (deleting) return
    setConfirmDelete(false)
    setConfirmUnknown(false)
    setDeleteError(null)
  }
  /** Delete the given records, one request each; failures stay selected and are reported. */
  const deleteRecords = async (targets: string[]): Promise<void> => {
    setDeleting(true)
    setDeleteError(null)
    const outcomes = await Promise.all(targets.map(async (id) => {
      try {
        const res = await fetch(`${RECORD_ENDPOINT}${encodeURIComponent(id)}`, { method: 'DELETE' })
        if (res.ok) return { id, ok: true as const }
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        return { id, ok: false as const, error: body?.error ?? `HTTP ${res.status}` }
      } catch {
        return { id, ok: false as const, error: 'network' }
      }
    }))
    const deletedIds = new Set(outcomes.filter((o) => o.ok).map((o) => o.id))
    const failures = outcomes.filter((o) => !o.ok)
    setSelected((prev) => new Set([...prev].filter((id) => !deletedIds.has(id))))
    if (failures.length > 0) {
      setDeleteError(t('deleteFailed', { n: failures.length, message: failures[0]!.error ?? '' }))
    } else {
      setConfirmDelete(false)
      setConfirmUnknown(false)
    }
    setDeleting(false)
    setRefreshTick((tick) => tick + 1)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Toolbar: normal/select mode switch; in select mode: select all + delete.
          Its height is fixed, so entering or leaving select mode never moves the list. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: TOOLBAR_CONTROL_HEIGHT, flexWrap: 'nowrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            style={selectMode ? { ...modeButtonStyle, color: 'var(--dsw-alias-state-business-primary)', borderColor: 'var(--dsw-alias-state-business-primary)' } : modeButtonStyle}
            onClick={() => switchSelectMode(!selectMode)}
          >
            {selectMode ? t('exitSelectMode') : t('enterSelectMode')}
          </button>
          {selectMode && (
            <button type="button" onClick={toggleAll} style={modeButtonStyle}>
              {allSelected ? t('selectNone') : t('selectAll')}
            </button>
          )}
        </span>
        {selectMode && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
            {selected.size > 0 && (
              <span style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>{t('selectedCount', { n: selected.size })}</span>
            )}
            <button
              type="button"
              disabled={selected.size === 0}
              style={selected.size === 0 ? { ...toolbarDangerButtonStyle, opacity: 0.4, cursor: 'default' } : toolbarDangerButtonStyle}
              onClick={() => { setDeleteError(null); setConfirmDelete(true) }}
            >
              {t('deleteSelected')}
            </button>
          </span>
        )}
      </div>
      {/* The unclosed record: engine state rather than a list row, hence pinned on its own.
          It is rejected by DELETE while open (409), so it never joins the selection. */}
      {open !== null && (
        <button
          type="button"
          onClick={() => setSelectedId(open.id)}
          style={{
            ...openRowStyle,
            textAlign: 'left',
            cursor: 'pointer',
            background: 'none',
            width: '100%',
            font: 'inherit',
            color: 'inherit',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <span style={rowTitleStyle}>{open.title || open.id}</span>
            <span style={runningBadgeStyle}>{t('incomplete')}</span>
          </div>
          <div style={{ marginTop: 4, color: 'var(--dsw-alias-label-secondary)', fontSize: 12 }}>
            {formatTime(open.openedAt)}
          </div>
        </button>
      )}
      {/* Records the engine counts but cannot show: no header line, or a version below the current one.
          Clicking the line offers to delete them, since nothing else can reach them. */}
      <UnknownRecordsLine
        ids={unknownIds}
        count={unknownCount}
        onDelete={() => { setDeleteError(null); setConfirmUnknown(true) }}
      />
      {items.map((row) => (
        <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            aria-label={selectMode ? t('selectRow') : undefined}
            aria-pressed={selectMode ? selected.has(row.id) : undefined}
            onClick={() => (selectMode ? toggle(row.id) : setSelectedId(row.id))}
            style={selectMode && selected.has(row.id) ? { ...rowButtonStyle, ...selectedRowStyle } : rowButtonStyle}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <span style={rowTitleStyle}>{row.title || row.id}</span>
            </div>
            <div style={{ marginTop: 4, color: 'var(--dsw-alias-label-secondary)', fontSize: 12 }}>
              {formatTime(row.openedAt)} → {formatTime(row.endedAt)}
            </div>
          </button>
        </div>
      ))}
      <Dialog
        open={confirmDelete}
        title={t('deleteSelected')}
        width={360}
        onClose={closeConfirm}
        footer={[
          <GhostButton key="cancel" onClick={closeConfirm}>{t('cancel')}</GhostButton>,
          <button
            key="delete"
            type="button"
            style={dangerButtonStyle}
            disabled={deleting}
            onClick={() => void deleteRecords([...selected])}
          >
            {t('delete')}
          </button>,
        ]}
      >
        <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-primary)' }}>{t('deleteRecordsConfirm', { n: selected.size })}</div>
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>{t('irreversible')}</div>
        {deleteError !== null && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--dsw-alias-state-error-primary)', lineHeight: 1.5, wordBreak: 'break-word' }}>{deleteError}</div>
        )}
      </Dialog>
      <Dialog
        open={confirmUnknown}
        title={t('deleteUnknown')}
        width={360}
        onClose={closeConfirm}
        footer={[
          <GhostButton key="cancel" onClick={closeConfirm}>{t('cancel')}</GhostButton>,
          <button
            key="delete"
            type="button"
            style={dangerButtonStyle}
            disabled={deleting}
            onClick={() => void deleteRecords(unknownIds)}
          >
            {t('delete')}
          </button>,
        ]}
      >
        <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-primary)' }}>{t('deleteUnknownConfirm', { n: unknownIds.length })}</div>
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>{t('irreversible')}</div>
        {deleteError !== null && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--dsw-alias-state-error-primary)', lineHeight: 1.5, wordBreak: 'break-word' }}>{deleteError}</div>
        )}
      </Dialog>
    </div>
  )
}
