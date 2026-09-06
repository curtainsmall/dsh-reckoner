/**
 * ElectroLab record list page.
 * The list reads the host's /records-index (a projection of record-index.jsonl);
 * clicking a row opens the record's trace timeline (record-detail.tsx).
 */
import { useEffect, useState } from 'react'
import { t, useAppLocale } from './locales.ts'
import { Dialog, GhostButton, PrimaryButton } from './ui.tsx'
import { RecordDetail } from './record-detail.tsx'

/* ── record list ─────────────────────────────────────────────────────────── */

/** Index-row mirror (one line of record-index.jsonl). */
interface IndexRow {
  id: string
  openedAt: number
  sealedAt: number | null
  question: string
}

const INDEX_ENDPOINT = '/api/dsh-electro-lab/records-index'
const RECORD_ENDPOINT = '/api/dsh-electro-lab/records/'
const POLL_MS = 5000

const rowStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 6,
  border: '1px solid var(--dsw-alias-border-l2)',
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

/** Neutral action button (select mode toggle …). */
const modeButtonStyle: React.CSSProperties = {
  padding: '3px 10px',
  borderRadius: 6,
  border: '1px solid var(--dsw-alias-label-tertiary)',
  background: 'none',
  color: 'var(--dsw-alias-label-primary)',
  cursor: 'pointer',
  fontSize: 12.5,
  fontWeight: 600,
}
function formatTime(time: number): string {
  return new Date(time).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Record list page: render from the index (title = question); unsealed rows are marked incomplete; polls every 5s. */
export function RecordsTab(): React.JSX.Element {
  useAppLocale()
  const [rows, setRows] = useState<IndexRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Two list modes: normal (click opens a record) and select (checkboxes + delete).
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
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
        const body = (await res.json()) as { rows: IndexRow[] }
        if (!alive) return
        setRows(body.rows)
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

  // Newest first: the index is append-ordered, the list shows recency order.
  const items = [...(rows ?? [])].sort((a, b) => b.openedAt - a.openedAt)
  if (items.length === 0) {
    return (
      <div style={rowStyle}>
        <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>{t('emptyHint')}</span>
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
    setDeleteError(null)
  }
  const runDelete = async (): Promise<void> => {
    setDeleting(true)
    setDeleteError(null)
    const targets = [...selected]
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
    }
    setDeleting(false)
    setRefreshTick((tick) => tick + 1)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Toolbar: normal/select mode switch; in select mode: select all + delete. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            style={selectMode ? { ...modeButtonStyle, color: 'var(--dsw-alias-state-business-primary)', borderColor: 'var(--dsw-alias-state-business-primary)' } : modeButtonStyle}
            onClick={() => switchSelectMode(!selectMode)}
          >
            {selectMode ? t('exitSelectMode') : t('enterSelectMode')}
          </button>
          {selectMode && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--dsw-alias-label-primary)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                style={{ accentColor: 'var(--dsw-alias-state-business-primary)' }}
              />
              {t('selectAll')}
            </label>
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
              style={selected.size === 0 ? { ...dangerButtonStyle, opacity: 0.4, cursor: 'default' } : dangerButtonStyle}
              onClick={() => { setDeleteError(null); setConfirmDelete(true) }}
            >
              {t('deleteSelected')}
            </button>
          </span>
        )}
      </div>
      {items.map((row) => (
        <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {selectMode && (
            <input
              type="checkbox"
              aria-label={t('selectRow')}
              checked={selected.has(row.id)}
              onChange={() => toggle(row.id)}
              style={{ accentColor: 'var(--dsw-alias-state-business-primary)', flex: 'none' }}
            />
          )}
          <button
            type="button"
            onClick={() => (selectMode ? toggle(row.id) : setSelectedId(row.id))}
            style={{
              ...rowStyle,
              textAlign: 'left',
              cursor: 'pointer',
              background: 'none',
              width: '100%',
              font: 'inherit',
              color: 'inherit',
              flex: '1 1 auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <span style={{
                color: 'var(--dsw-alias-label-primary)',
                fontSize: 13,
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                minWidth: 0,
              }}>
                {row.question || row.id}
              </span>
              {row.sealedAt === null && (
                <span
                  style={{
                    padding: '1px 7px',
                    borderRadius: 999,
                    fontSize: 11,
                    border: '1px solid var(--dsw-alias-state-warn-primary)',
                    color: 'var(--dsw-alias-state-warn-primary)',
                    flex: 'none',
                  }}
                >
                  {t('incomplete')}
                </span>
              )}
            </div>
            <div style={{ marginTop: 4, color: 'var(--dsw-alias-label-secondary)', fontSize: 12 }}>
              {formatTime(row.openedAt)}
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
            onClick={() => void runDelete()}
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
    </div>
  )
}
