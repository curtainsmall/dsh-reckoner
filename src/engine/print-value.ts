/**
 * The value printer: the inverse of the parser.
 *
 * A stored value is SI and rectangular; the format decides how it is written
 * out. Printing never changes the value — it is a `print`/`printf` choice, not a
 * conversion — and the format vocabulary is the same one the parser accepts, so
 * what `get` prints can usually be fed straight back in:
 *
 *   get R1                 → "4700ohm"      SI form: no prefix, the unit word follows
 *   get R1 format "kohm"   → "4.7kohm"
 *   get T  format "degC"   → "25degC"
 *   get Z                  → "100+50j"      rectangular
 *   get Z  format "polar"  → "111.80339887498948∠0.4636476090008061"
 *   get R1 format "json"   → {"type":"number","value":4700,"kind":"resistance"}
 *
 * One exception to round-tripping: a complex printed with a unit is not a
 * parseable scalar (the parser reads `3+4j`), so a complex is always printed in
 * the unitless rectangular or polar form.
 */
import { ToolError, ToolErrorCode } from '../errors.ts'
import { KIND_UNIT, PREFIX_SCALES, UNITS, isPrefix, isUnit } from './units.ts'
import type { TypedValue } from './values.ts'

/** A resolved print format. */
type Format =
  | { kind: 'si' }
  | { kind: 'json' }
  | { kind: 'polar' }
  | { kind: 'unit'; scale: number; word: string }

/** Significant digits kept before the SI form falls back to exponential. */
const PRECISION = 12

/** Render a number compactly: an exponent only when the magnitude really needs one. */
function num(value: number): string {
  if (value === 0) return '0'
  if (Number.isInteger(value) && Math.abs(value) < 1e21) return String(value)
  const magnitude = Math.abs(value)
  if (magnitude >= 1e-4 && magnitude < 1e16) return String(Number(value.toPrecision(PRECISION)))
  return value.toExponential(6).replace(/\.?0+e/, 'e')
}

/**
 * Resolve a format word: a unit word ("ohm", "degC"), a prefix + unit ("kohm"),
 * "polar", "json", or nothing for the SI form.
 *
 * `rad` is the one alias: an angle prints in radians as `radian`, and the short
 * spelling is what a reader asks for.
 */
function resolveFormat(format: string | undefined): Format {
  if (format === undefined || format.length === 0) return { kind: 'si' }
  if (format === 'json') return { kind: 'json' }
  if (format === 'polar') return { kind: 'polar' }
  if (format === 'rad') return { kind: 'unit', scale: 1, word: 'radian' }
  if (isUnit(format)) return { kind: 'unit', scale: 1, word: format }
  const head = format.slice(0, 1)
  const tail = format.slice(1)
  if (isPrefix(head) && isUnit(tail)) return { kind: 'unit', scale: PREFIX_SCALES[head] as number, word: tail }
  throw new ToolError(
    `unknown format "${format}" — use a unit ("ohm"), a prefix+unit ("kohm"), a variant ("degC"), "deg", "rad", "polar" or "json". ` +
    'Units are whole words (ohm volt amp watt hertz second farad henry kelvin metre gram pascal joule radian decibel, ' +
    'degC degF deg bar psi atm cal Wh hp inch foot yard mile lb oz) and prefixes are one letter (p n u m k M G T)',
    ToolErrorCode.ArgsInvalid,
  )
}

/** Print one quantity: `si`/`unit` carry the unit word, `json` gives the envelope. */
function printQuantity(value: number, kind: string, format: Format): string {
  switch (format.kind) {
    case 'json':
      return JSON.stringify({ type: 'number', value, kind })
    case 'polar':
      throw new ToolError('the "polar" format applies to a complex value, not to a single quantity', ToolErrorCode.ArgsInvalid)
    case 'si': {
      const word = KIND_UNIT[kind]
      return word === undefined ? num(value) : `${num(value)}${word}`
    }
    case 'unit': {
      const info = UNITS[format.word]
      if (info === undefined || info.kind !== kind) {
        throw new ToolError(
          `format "${format.word}" does not express ${kind} — the unit for that is ${KIND_UNIT[kind] ?? '(none)'}`,
          ToolErrorCode.UnsupportedVariant,
        )
      }
      const scaled = (value - info.offset) / info.factor / format.scale
      return `${num(scaled)}${prefixLetter(format.scale)}${format.word}`
    }
  }
}

/** The prefix letter for a scale, so the printed form parses back. */
function prefixLetter(scale: number): string {
  if (scale === 1) return ''
  for (const [letter, value] of Object.entries(PREFIX_SCALES)) {
    if (value === scale) return letter
  }
  return ''
}

/** Print a complex in the unitless rectangular form the parser reads back. */
function printComplex(re: number, im: number): string {
  return `${num(re)}${im < 0 ? '-' : '+'}${num(Math.abs(im))}j`
}

/** Print a canonical value. */
export function printValue(value: TypedValue, format?: string): string {
  const resolved = resolveFormat(format)
  switch (value.type) {
    case 'number':
      return printQuantity(value.value, value.kind, resolved)
    case 'complex': {
      const { re, im } = value.value
      if (resolved.kind === 'polar') return `${num(Math.hypot(re, im))}∠${num(Math.atan2(im, re))}`
      if (resolved.kind === 'json') return JSON.stringify({ type: 'complex', value: { re, im }, kind: value.kind })
      // A complex is printed unitless: `3+4j` is what the parser accepts back.
      return printComplex(re, im)
    }
    case 'string':
      if (resolved.kind !== 'si') throw new ToolError('a string has no units to format', ToolErrorCode.ArgsInvalid)
      return JSON.stringify(value.value)
    case 'array':
      return `[${value.value.map((item) => printValue(item, format)).join(', ')}]`
    case 'object':
      return `{${Object.entries(value.value).map(([key, field]) => `${key}: ${printValue(field, format)}`).join(', ')}}`
  }
}
