/**
 * The value: what a slot holds and what a receipt echoes.
 *
 * Four types - number, complex (stored rectangular), array (one SI vector for
 * the whole array) and object (one vector per field). Numeric positions hold
 * JSON numbers only. `set`'s tagged structure is parsed here, and every
 * receipt is rendered here, so the receipt shape and the accepted input shape
 * cannot drift apart.
 */
import { fail } from '../errors.ts'
import { describe } from './describe.ts'
import { requireIdentifier } from './identifier.ts'
import {
  ZERO_SI_VECTOR,
  type DimSpec,
  type SiVector,
  affineBackward,
  affineForward,
  formatSiVector,
  isIntegralSiVector,
  isZeroSiVector,
  kindOfSiVector,
  parseDim,
  siTableRow,
  siVectorsEqual,
  spellSiVector,
} from './si-vector.ts'

export interface RealValue {
  readonly kind: 'number'
  readonly num: number
  readonly dim: SiVector
}

export interface ComplexValue {
  readonly kind: 'complex'
  readonly re: number
  readonly im: number
  readonly dim: SiVector
}

/** The array's own vector is the shared vector of its elements. */
export interface ArrayValue {
  readonly kind: 'array'
  readonly items: readonly Value[]
  readonly dim: SiVector
}

export interface ObjectValue {
  readonly kind: 'object'
  readonly fields: Readonly<Record<string, Value>>
}

export type Value = RealValue | ComplexValue | ArrayValue | ObjectValue

/** A complex number in rectangular form, without a vector. */
export interface Scalar {
  readonly re: number
  readonly im: number
}

export function realValue(num: number, dim: SiVector = ZERO_SI_VECTOR): RealValue {
  return { kind: 'number', num, dim }
}

export function complexValue(re: number, im: number, dim: SiVector): ComplexValue {
  return { kind: 'complex', re, im, dim }
}

/** The vector of any value: an object's is its fields' (used only where they provably agree). */
export function valueSiVector(value: Value): SiVector | undefined {
  return value.kind === 'object' ? undefined : value.dim
}

/** Build an array whose elements must share one SI vector. */
export function collectArray(items: readonly Value[], where: string): ArrayValue {
  const first = items[0]
  if (first === undefined) return { kind: 'array', items, dim: ZERO_SI_VECTOR }
  const dim = first.kind === 'object' ? undefined : first.dim
  if (dim === undefined) {
    fail('ENGINE_UNSUPPORTED_OPERATION', `${where}: an object cannot be an element of an array; an array's elements are numbers or nested arrays sharing one SI vector.`)
  }
  for (const item of items) {
    if (item.kind === 'object') {
      fail('ENGINE_UNSUPPORTED_OPERATION', `${where}: an object cannot be an element of an array; an array's elements are numbers or nested arrays sharing one SI vector.`)
    }
    if (!siVectorsEqual(item.dim, dim)) {
      fail(
        'ENGINE_INCOMPATIBLE_DIMENSION',
        `${where}: every element of an array must share one SI vector, but one element is ${formatSiVector(item.dim)} (${kindOfSiVector(item.dim)}) while another is ${formatSiVector(dim)} (${kindOfSiVector(dim)}).`,
      )
    }
  }
  return { kind: 'array', items, dim }
}

function requireJsonNumber(input: unknown, where: string): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    fail('ENGINE_INVALID_ARGS', `${where}: expected a JSON number; got ${describe(input)}.`)
  }
  return input
}

const VALUE_KEYS = ['num', 're', 'im', 'mag', 'ang', 'array', 'object', 'dim']

function hasKey(bag: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(bag, key)
}

function requireBag(input: unknown, where: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    fail(
      'ENGINE_INVALID_ARGS',
      `${where}: expected an object carrying exactly one tag of num, re+im, mag+ang, array or object; got ${describe(input)}.`,
    )
  }
  return input as Record<string, unknown>
}

/** The scaled scalar of a value that is already SI: `factor * z + offset` with the offset on the real part only. */
function forwardScalar(scalar: Scalar, spec: DimSpec): Scalar {
  return { re: affineForward(scalar.re, spec), im: scalar.im * spec.factor }
}

/** One array element: a bare scalar or a nested array, sharing the array's vector. */
function parseBareElement(input: unknown, dim: SiVector, where: string): Value {
  if (typeof input === 'number') return realValue(requireJsonNumber(input, where), dim)
  if (Array.isArray(input)) {
    return { kind: 'array', items: input.map((item, index) => parseBareElement(item, dim, `${where}[${index}]`)), dim }
  }
  if (typeof input === 'object' && input !== null) {
    const bag = input as Record<string, unknown>
    const keys = Object.keys(bag)
    const rectangular = keys.length === 2 && hasKey(bag, 're') && hasKey(bag, 'im')
    const polar = keys.length === 2 && hasKey(bag, 'mag') && hasKey(bag, 'ang')
    if (rectangular) {
      return complexValue(requireJsonNumber(bag['re'], `${where}.re`), requireJsonNumber(bag['im'], `${where}.im`), dim)
    }
    if (polar) {
      const mag = requireJsonNumber(bag['mag'], `${where}.mag`)
      const ang = requireJsonNumber(bag['ang'], `${where}.ang`)
      return complexValue(mag * Math.cos(ang), mag * Math.sin(ang), dim)
    }
  }
  fail(
    'ENGINE_INVALID_ARGS',
    `${where}: an array element is a bare number, {re,im}, {mag,ang} or a nested array - it carries no tag and no dim, because the whole array shares one SI vector. Got ${describe(input)}.`,
  )
}

/** `set`'s `value`: exactly one complete tag, or a nested object of them. */
export function parseSetValue(input: unknown, where = 'value'): Value {
  const bag = requireBag(input, where)
  for (const key of Object.keys(bag)) {
    if (!VALUE_KEYS.includes(key)) {
      fail('ENGINE_INVALID_ARGS', `${where}: unknown key "${key}"; the tags are num, re+im, mag+ang, array, object and dim.`)
    }
  }
  const numTag = hasKey(bag, 'num')
  const rectTag = hasKey(bag, 're') || hasKey(bag, 'im')
  const polarTag = hasKey(bag, 'mag') || hasKey(bag, 'ang')
  const arrayTag = hasKey(bag, 'array')
  const objectTag = hasKey(bag, 'object')
  const tags = [numTag, rectTag, polarTag, arrayTag, objectTag].filter(Boolean).length
  if (tags !== 1) {
    fail(
      'ENGINE_INVALID_ARGS',
      `${where}: exactly one tag must be given - num, re+im, mag+ang, array or object; got ${describe(input)}.`,
    )
  }
  if (objectTag && hasKey(bag, 'dim')) {
    fail('ENGINE_INVALID_ARGS', `${where}: an object carries one dim per field, so it takes no "dim" of its own; move "dim" into each field.`)
  }
  const spec = parseDim(bag['dim'], `${where}.dim`)

  if (numTag) {
    return realValue(affineForward(requireJsonNumber(bag['num'], `${where}.num`), spec), spec.vector)
  }
  if (rectTag) {
    if (!hasKey(bag, 're') || !hasKey(bag, 'im')) {
      fail('ENGINE_INVALID_ARGS', `${where}: the rectangular form needs both "re" and "im"; got ${describe(input)}.`)
    }
    const re = requireJsonNumber(bag['re'], `${where}.re`)
    const im = requireJsonNumber(bag['im'], `${where}.im`)
    const scaled = forwardScalar({ re, im }, spec)
    return complexValue(scaled.re, scaled.im, spec.vector)
  }
  if (polarTag) {
    if (!hasKey(bag, 'mag') || !hasKey(bag, 'ang')) {
      fail('ENGINE_INVALID_ARGS', `${where}: the polar form needs both "mag" and "ang" (radians); got ${describe(input)}.`)
    }
    const mag = requireJsonNumber(bag['mag'], `${where}.mag`)
    const ang = requireJsonNumber(bag['ang'], `${where}.ang`)
    const scaled = forwardScalar({ re: mag * Math.cos(ang), im: mag * Math.sin(ang) }, spec)
    return complexValue(scaled.re, scaled.im, spec.vector)
  }
  if (arrayTag) {
    const list = bag['array']
    if (!Array.isArray(list)) {
      fail('ENGINE_INVALID_ARGS', `${where}.array: expected an array; got ${describe(list)}.`)
    }
    return { kind: 'array', items: list.map((item, index) => parseBareElement(item, spec.vector, `${where}.array[${index}]`)), dim: spec.vector }
  }
  const fields = bag['object']
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
    fail('ENGINE_INVALID_ARGS', `${where}.object: expected an object of named fields; got ${describe(fields)}.`)
  }
  const parsed: Record<string, Value> = {}
  for (const [key, field] of Object.entries(fields as Record<string, unknown>)) {
    requireIdentifier(key, `${where}.object field name`)
    parsed[key] = parseSetValue(field, `${where}.object.${key}`)
  }
  return { kind: 'object', fields: parsed }
}

/** The stored value's `dim` must match the requested one: `get`'s `dim` is a claim about the slot. */
export function assertValueDim(value: Value, target: DimSpec, label: string): void {
  if (value.kind === 'object') {
    for (const [key, field] of Object.entries(value.fields)) assertValueDim(field, target, `${label}, field "${key}",`)
    return
  }
  if (siVectorsEqual(value.dim, target.vector)) return
  const wanted = target.name ?? formatSiVector(target.vector)
  fail(
    'ENGINE_INCOMPATIBLE_DIMENSION',
    `${label} holds ${spellSiVector(value.dim)} ${formatSiVector(value.dim)} but dim "${wanted}" is ${formatSiVector(target.vector)} (${kindOfSiVector(target.vector)}). Read it without dim, or convert in a formula instead.`,
  )
}

/** Only whole SI vectors land in a slot: a fractional one is refused here. */
export function assertIntegralValue(value: Value, label: string): void {
  if (value.kind === 'object') {
    for (const [key, field] of Object.entries(value.fields)) assertIntegralValue(field, `${label}.${key}`)
    return
  }
  if (isIntegralSiVector(value.dim)) return
  fail(
    'ENGINE_INCOMPATIBLE_DIMENSION',
    `${label} would hold the SI vector ${formatSiVector(value.dim)}, whose exponents are not all integers (a fractional vector comes from a root or a fractional power). Scale the formula so the result is a whole vector.`,
  )
}

/** Round to at most `digits` significant digits, never padding. */
export function roundSignificant(x: number, digits: number): number {
  if (x === 0 || !Number.isFinite(x)) return x
  const exponent = Math.floor(Math.log10(Math.abs(x)))
  const factor = 10 ** (digits - 1 - exponent)
  if (!Number.isFinite(factor) || factor === 0) return x
  const rounded = Math.round(x * factor) / factor
  return Object.is(rounded, -0) ? 0 : rounded
}

function round(x: number, digits: number | undefined): number {
  return digits === undefined ? x : roundSignificant(x, digits)
}

/** A complex number after the affine reverse map of the requested spelling. */
function backwardScalar(scalar: Scalar, spec: DimSpec): Scalar {
  return { re: affineBackward(scalar.re, spec), im: scalar.im / spec.factor }
}

export interface RenderOptions {
  /** `rect` / `polar`; omitted keeps the stored form (a real stays `num`, a complex stays `re`/`im`). */
  readonly form?: 'rect' | 'polar'
  /** Significant digits for every leaf number; omitted keeps the raw float. */
  readonly digits?: number
  /** The requested spelling: leaves are mapped out of SI through it before form and digits. */
  readonly scale?: DimSpec
  /** How a vector is spelled in the receipt: its name, or the 7 integers themselves. */
  readonly spellDim: (dim: SiVector) => SiVector | string
}

/** One scalar's payload, already scaled, formed and rounded - without its dim. */
function scalarPayload(scalar: Scalar, options: RenderOptions, isComplex: boolean): Record<string, unknown> {
  const scaled = scaledScalar(scalar, options)
  if (options.form === 'rect') {
    return { re: round(scaled.re, options.digits), im: round(scaled.im, options.digits) }
  }
  if (options.form === 'polar') {
    const mag = round(Math.hypot(scaled.re, scaled.im), options.digits)
    if (!isComplex && scaled.re < 0) return { mag, ang: Math.PI }
    return { mag, ang: round(Math.atan2(scaled.im, scaled.re), options.digits) }
  }
  if (isComplex) return { re: round(scaled.re, options.digits), im: round(scaled.im, options.digits) }
  return { num: round(scaled.re, options.digits) }
}

function scalarOfValue(value: RealValue | ComplexValue): Scalar {
  return value.kind === 'number' ? { re: value.num, im: 0 } : { re: value.re, im: value.im }
}

function scaledScalar(scalar: Scalar, options: RenderOptions): Scalar {
  return options.scale === undefined ? scalar : backwardScalar(scalar, options.scale)
}

/** An array element: a bare scalar or a nested array, never carrying a dim of its own. */
function renderBareValue(value: Value, options: RenderOptions): unknown {
  if (value.kind === 'array') return value.items.map((item) => renderBareValue(item, options))
  if (value.kind === 'object') return renderValue(value, options)
  // Bare means the number itself: a real is `1`, not `{num: 1}`.
  if (options.form === undefined && value.kind === 'number') {
    return round(scaledScalar(scalarOfValue(value), options).re, options.digits)
  }
  return scalarPayload(scalarOfValue(value), options, value.kind === 'complex')
}

/** The receipt shape: the same tagged structure `set` accepts, echo of what is stored. */
export function renderValue(value: Value, options: RenderOptions): unknown {
  if (value.kind === 'object') {
    const fields: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(value.fields)) fields[key] = renderValue(field, options)
    return { object: fields }
  }
  if (value.kind === 'array') {
    return { array: value.items.map((item) => renderBareValue(item, options)), dim: options.spellDim(value.dim) }
  }
  return { ...scalarPayload(scalarOfValue(value), options, value.kind === 'complex'), dim: options.spellDim(value.dim) }
}

/** The receipt spelling of a stored fact: 7 integers, so no name is ever stored. */
export function storedDimSpelling(dim: SiVector): SiVector {
  return dim
}

/** How a read mentions a vector: the table's first name, else the 7 integers. */
export function mentionDim(dim: SiVector): SiVector | string {
  const first = siTableRow(dim)?.names[0]
  return first === undefined ? dim : first.name
}

/** Whether a value is a plain dimensionless real, and its number. */
export function realScalarOf(value: Value): number | undefined {
  return value.kind === 'number' && isZeroSiVector(value.dim) ? value.num : undefined
}
