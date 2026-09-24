/**
 * Reckoner shared client UI: themed dialog + buttons and value display
 * helpers. Pure presentational code with no record imports, so any page
 * (record list, detail, editors) can use it without import cycles.
 */
import { useState, type ReactNode } from 'react'
import { spellSiVector, type SiVector } from '../engine/si-vector.ts'

/* ── Value display ──────────────────────────────────────────────────────── */

/** A stored value carries its SI vector: the table's first name, or the exponents themselves. */
function dimLabel(dim: unknown): string {
  if (typeof dim === 'string') return dim
  if (Array.isArray(dim) && dim.length === 7 && dim.every((part) => typeof part === 'number')) {
    return spellSiVector(dim as unknown as SiVector)
  }
  return ''
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  const abs = Math.abs(n)
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-3)) return n.toExponential(4).replace(/\.?0+e/, 'e')
  return String(Math.round(n * 10000) / 10000)
}

/** Render one stored value as human text: the number with its SI name, or the structure. */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return String(value)
  if (Array.isArray(value)) return `[ ${value.map((item) => displayValue(item)).join(', ')} ]`
  const v = value as Record<string, unknown>
  if (typeof v['object'] === 'object' && v['object'] !== null) {
    const fields = Object.entries(v['object'] as Record<string, unknown>)
    return `{ ${fields.map(([key, item]) => `${key}: ${displayValue(item)}`).join(', ')} }`
  }
  if (Array.isArray(v['array'])) {
    const dim = dimLabel(v['dim'])
    const body = (v['array'] as unknown[]).map((item) => displayValue(item)).join(', ')
    return `${dim.length > 0 ? `${dim} ` : ''}[ ${body} ]`
  }
  if (typeof v['num'] === 'number') return `${fmt(v['num'])} ${dimLabel(v['dim'])}`.trim()
  if (typeof v['re'] === 'number' || typeof v['im'] === 'number') {
    const re = typeof v['re'] === 'number' ? v['re'] : 0
    const im = typeof v['im'] === 'number' ? v['im'] : 0
    const sign = im < 0 ? '-' : '+'
    return `${fmt(re)} ${sign} j${fmt(Math.abs(im))} ${dimLabel(v['dim'])}`.trim()
  }
  if (typeof v['mag'] === 'number' && typeof v['ang'] === 'number') {
    return `${fmt(v['mag'])} angle ${fmt(v['ang'])} rad ${dimLabel(v['dim'])}`.trim()
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/* ── Dialog shell + buttons ─────────────────────────────────────────────── */

/** Shared modal: mask, themed panel, title (optionally with right-side content), body, footer. */
export function Dialog({ open, title, width = 400, height, dismissible = true, headerRight, footer, children, onClose }: {
  open: boolean
  title: string
  width?: number
  /** Fixed panel height: content scrolls within the body. */
  height?: number
  dismissible?: boolean
  headerRight?: ReactNode
  footer?: ReactNode
  children: ReactNode
  onClose: () => void
}): React.JSX.Element | null {
  if (!open) return null
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--dsw-alias-bg-mask-1)',
        pointerEvents: 'auto',
      }}
      onClick={dismissible ? onClose : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 48px)',
          ...(height === undefined ? {} : { height }),
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--dsw-alias-bg-layer-2)',
          border: '1px solid var(--dsw-alias-border-l2)',
          borderRadius: 10,
          padding: 16,
          boxShadow: 'var(--dsw-shadow-lv3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
          {headerRight}
        </div>
        <div style={{ marginTop: 12, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>{children}</div>
        {footer !== undefined && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14, flex: 'none' }}>{footer}</div>
        )}
      </div>
    </div>
  )
}

function ghostButtonStyle(hovered: boolean): React.CSSProperties {
  return {
    padding: '4px 12px',
    borderRadius: 6,
    border: '1px solid var(--dsw-alias-label-tertiary)',
    borderColor: hovered ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-tertiary)',
    background: hovered ? 'var(--dsw-alias-interactive-bg-hover)' : 'none',
    color: 'var(--dsw-alias-label-primary)',
    cursor: 'pointer',
    fontSize: 13,
  }
}

function primaryButtonStyle(hovered: boolean, disabled = false): React.CSSProperties {
  return {
    padding: '4px 12px',
    borderRadius: 6,
    border: '1px solid var(--dsw-alias-button-info-fill)',
    background: hovered && !disabled ? 'var(--dsw-alias-button-info-hover)' : 'var(--dsw-alias-button-info-fill)',
    color: 'var(--dsw-alias-label-primary-foreground)',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: 13,
    fontWeight: 600,
    opacity: disabled ? 0.45 : 1,
  }
}

/** Ghost button (secondary action). */
export function GhostButton({ children, onClick, disabled = false, style }: { children: ReactNode; onClick: () => void; disabled?: boolean; style?: React.CSSProperties }): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      type="button"
      style={{ ...ghostButtonStyle(hovered), ...style }}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
    </button>
  )
}

/** Primary button (primary action). */
export function PrimaryButton({ children, onClick, disabled = false }: { children: ReactNode; onClick: () => void; disabled?: boolean }): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      type="button"
      style={primaryButtonStyle(hovered, disabled)}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
    </button>
  )
}
