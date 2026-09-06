/**
 * ElectroLab shared client UI: themed dialog + buttons and typed-value
 * display helpers. Pure presentational code with no record imports, so any
 * page (record list, detail, editors) can use it without import cycles.
 */
import { useState, type ReactNode } from 'react'

/* ── Typed-value human display ──────────────────────────────────────────── */

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

/** Render one typed value as human text. Slot values are returned as "@name" markers. */
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
export function GhostButton({ children, onClick, style }: { children: ReactNode; onClick: () => void; style?: React.CSSProperties }): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      type="button"
      style={{ ...ghostButtonStyle(hovered), ...style }}
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
