/**
 * The value universe.
 *
 * A canonical value is what the engine stores, traces and prints:
 *
 *   { type: 'number',  value: 4700, kind: 'resistance' }
 *   { type: 'complex', value: { re: 100, im: 50 }, kind: 'resistance' }
 *   { type: 'string',  value: '…' }
 *   { type: 'array',   value: [ <value>, … ] }
 *   { type: 'object',  value: { <field>: <value>, … } }
 *
 * Three properties hold everywhere:
 *
 * - `kind` is required on `number` and `complex` and absent on the rest.
 * - A value is always in the SI base representation, as a rectangular complex
 *   when it is complex: no prefix word and no unit variant survives parsing, so
 *   the same quantity written two ways is the same stored value.
 * - There is no slot-reference type. `@name` is syntax inside a formula and is
 *   resolved before evaluation; a reference never enters a value, a slot or a
 *   trace row.
 *
 * There is no `boolean`: mathematics has no boolean type, and an indicator
 * function is a `0`/`1` with `kind: none`. Comparisons went with it — without a
 * conditional expression they are dead code.
 */
import { QuantityKind, QUANTITY_KIND_NAMES } from '../math/quantity-kind.ts'

export type Kind = QuantityKind

/** A number, a complex, or a nested structure of them. */
export type TypedValue =
  | { type: 'number'; value: number; kind: Kind }
  | { type: 'complex'; value: { re: number; im: number }; kind: Kind }
  | { type: 'string'; value: string }
  | { type: 'array'; value: TypedValue[] }
  | { type: 'object'; value: Record<string, TypedValue> }

/** A value that carries a kind: the arithmetic leaves. */
export type Scalar = Extract<TypedValue, { type: 'number' | 'complex' }>

const KIND_SET: ReadonlySet<string> = new Set(QUANTITY_KIND_NAMES)

/** True when a value is a number or complex (the shapes that carry a kind). */
export function isScalar(value: TypedValue): value is Scalar {
  return value.type === 'number' || value.type === 'complex'
}

/** The kind of a scalar, or undefined for the kind-less shapes. */
export function kindOf(value: TypedValue): Kind | undefined {
  return isScalar(value) ? value.kind : undefined
}

/**
 * Validate a canonical value's shape. Returns a message, or undefined when the
 * value is well formed. Used by the parser's own output check and by tests; a
 * value that reaches a slot has already been through it.
 */
export function validateValue(raw: unknown, path = 'value'): string | undefined {
  if (typeof raw !== 'object' || raw === null) return `${path}: a typed-value object is required, got ${typeof raw}`
  const value = raw as { type?: unknown; value?: unknown; kind?: unknown }
  switch (value.type) {
    case 'number': {
      if (typeof value.value !== 'number' || !Number.isFinite(value.value)) return `${path}: number value must be a finite number`
      if (typeof value.kind !== 'string') return `${path}: number requires a kind`
      if (!KIND_SET.has(value.kind)) return `${path}: unknown kind "${value.kind}"`
      return undefined
    }
    case 'complex': {
      const payload = value.value as { re?: unknown; im?: unknown }
      if (typeof payload !== 'object' || payload === null) return `${path}: complex value must be {re, im}`
      if (typeof payload.re !== 'number' || typeof payload.im !== 'number') return `${path}: complex value must be {re, im} numbers`
      if (typeof value.kind !== 'string') return `${path}: complex requires a kind`
      if (!KIND_SET.has(value.kind)) return `${path}: unknown kind "${value.kind}"`
      return undefined
    }
    case 'string':
      return typeof value.value === 'string' ? undefined : `${path}: string value must be a string`
    case 'array': {
      if (!Array.isArray(value.value)) return `${path}: array value must be an array`
      for (let i = 0; i < value.value.length; i += 1) {
        const problem = validateValue(value.value[i], `${path}[${i}]`)
        if (problem !== undefined) return problem
      }
      return undefined
    }
    case 'object': {
      if (typeof value.value !== 'object' || value.value === null || Array.isArray(value.value)) return `${path}: object value must be an object`
      for (const [key, field] of Object.entries(value.value)) {
        const problem = validateValue(field, `${path}.${key}`)
        if (problem !== undefined) return problem
      }
      return undefined
    }
    default:
      return `${path}: unknown type "${String(value.type)}"`
  }
}

/**
 * Bring a value to its canonical form: a polar complex becomes rectangular and
 * the conversion recurses into arrays and objects. Everything else is already
 * canonical — the parser emits SI and rectangular form — so this is idempotent
 * and exists for values built in code (tests, future callers).
 */
export function toCanonical(value: TypedValue): TypedValue {
  switch (value.type) {
    case 'number':
    case 'string':
      return value
    case 'complex': {
      const payload = value.value as { re?: number; im?: number; mag?: number; ang?: number }
      if (typeof payload.re === 'number' && typeof payload.im === 'number') {
        return { type: 'complex', value: { re: payload.re, im: payload.im }, kind: value.kind }
      }
      const mag = payload.mag ?? 0
      const ang = payload.ang ?? 0
      return { type: 'complex', value: { re: mag * Math.cos(ang), im: mag * Math.sin(ang) }, kind: value.kind }
    }
    case 'array':
      return { type: 'array', value: value.value.map(toCanonical) }
    case 'object':
      return { type: 'object', value: Object.fromEntries(Object.entries(value.value).map(([key, field]) => [key, toCanonical(field)])) }
  }
}

/**
 * Read a component of a value by a path of literal names: `@th.v` is `refPath(th, 'v')`.
 * Only object fields are walked — an index into an array is an expression, not a
 * literal name, and is resolved by the evaluator instead.
 */
export function refPath(value: TypedValue, path: string | undefined): TypedValue {
  if (path === undefined || path.length === 0) return value
  let current = value
  for (const segment of path.split('.')) {
    if (current.type !== 'object') throw new Error(`path "${path}" steps through a ${current.type}, which has no fields`)
    const next = current.value[segment]
    if (next === undefined) throw new Error(`path "${path}" has no field "${segment}"`)
    current = next
  }
  return current
}

/** The numeric payload of a scalar as a complex. */
export function payloadOf(value: Scalar): { re: number; im: number } {
  return value.type === 'number' ? { re: value.value, im: 0 } : value.value
}
