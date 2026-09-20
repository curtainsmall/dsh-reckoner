/**
 * The word tables behind the value grammar: metric prefixes and the unit words
 * a value can be written in. A "variant" is not a separate concept — it is a
 * unit word whose conversion to the SI base is affine rather than a plain
 * factor.
 *
 * Two rules shape these tables, and both are deliberate:
 *
 * - **Prefixes are one letter, unit words are whole words.** There are only
 *   eight prefixes, unambiguous because they can only sit between a number and
 *   a unit; unit words are many and would collide (`m` is both milli and metre,
 *   `h` both henry and hour), so they are spelled out.
 * - **A parsed value is stored in SI, with no trace of the prefix or the word.**
 *   `4.7kohm` and `4700ohm` are the same stored value; `25degC` becomes 298.15
 *   kelvin. Printing is the inverse of parsing, driven by `get`'s format.
 *
 * No symbols: `Ω`, `°C`, `µ` are rejected at the character level. Everything is
 * ASCII, and case matters only where SI defines it (M vs m, Wh).
 */
import { QuantityKind } from '../math/quantity-kind.ts'

/** Metric prefixes, one letter each. */
export const PREFIX_SCALES: Readonly<Record<string, number>> = {
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  m: 1e-3,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
}

/** One unit word: the kind it expresses and its affine map onto the SI base. */
export interface UnitInfo {
  kind: QuantityKind
  /** `si = value × factor + offset` */
  factor: number
  offset: number
}

/**
 * Every unit word. The offset is zero for all but the temperature scales and is
 * what makes `10kdegC` work: the prefix scales the value, the word's offset is
 * added once, and the result is 10273.15 kelvin.
 */
export const UNITS: Readonly<Record<string, UnitInfo>> = {
  // base kinds
  second: { kind: QuantityKind.Time, factor: 1, offset: 0 },
  metre: { kind: QuantityKind.Length, factor: 1, offset: 0 },
  gram: { kind: QuantityKind.Mass, factor: 1, offset: 0 },
  amp: { kind: QuantityKind.Current, factor: 1, offset: 0 },
  kelvin: { kind: QuantityKind.Temperature, factor: 1, offset: 0 },
  radian: { kind: QuantityKind.Angle, factor: 1, offset: 0 },
  decibel: { kind: QuantityKind.Log, factor: 1, offset: 0 },
  // derived kinds
  hertz: { kind: QuantityKind.Frequency, factor: 1, offset: 0 },
  ohm: { kind: QuantityKind.Resistance, factor: 1, offset: 0 },
  farad: { kind: QuantityKind.Capacitance, factor: 1, offset: 0 },
  henry: { kind: QuantityKind.Inductance, factor: 1, offset: 0 },
  volt: { kind: QuantityKind.Voltage, factor: 1, offset: 0 },
  watt: { kind: QuantityKind.Power, factor: 1, offset: 0 },
  pascal: { kind: QuantityKind.Pressure, factor: 1, offset: 0 },
  joule: { kind: QuantityKind.Energy, factor: 1, offset: 0 },
  // non-SI words for a base kind (affine for temperature, a plain factor elsewhere)
  degC: { kind: QuantityKind.Temperature, factor: 1, offset: 273.15 },
  degF: { kind: QuantityKind.Temperature, factor: 5 / 9, offset: (459.67 * 5) / 9 },
  deg: { kind: QuantityKind.Angle, factor: Math.PI / 180, offset: 0 },
  bar: { kind: QuantityKind.Pressure, factor: 1e5, offset: 0 },
  psi: { kind: QuantityKind.Pressure, factor: 6894.757293168, offset: 0 },
  atm: { kind: QuantityKind.Pressure, factor: 101325, offset: 0 },
  cal: { kind: QuantityKind.Energy, factor: 4.184, offset: 0 },
  Wh: { kind: QuantityKind.Energy, factor: 3600, offset: 0 },
  hp: { kind: QuantityKind.Power, factor: 745.69987158227022, offset: 0 },
  inch: { kind: QuantityKind.Length, factor: 0.0254, offset: 0 },
  foot: { kind: QuantityKind.Length, factor: 0.3048, offset: 0 },
  yard: { kind: QuantityKind.Length, factor: 0.9144, offset: 0 },
  mile: { kind: QuantityKind.Length, factor: 1609.344, offset: 0 },
  lb: { kind: QuantityKind.Mass, factor: 0.45359237, offset: 0 },
  oz: { kind: QuantityKind.Mass, factor: 0.028349523125, offset: 0 },
}

/**
 * The word the SI form prints with, one per kind. Every kind has exactly one, so
 * `get` with no format always has something to write.
 */
export const KIND_UNIT: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(UNITS)
    .filter(([, info]) => info.factor === 1 && info.offset === 0)
    .map(([word, info]) => [info.kind, word]),
)

/** The unit words that express a kind, the SI one first. */
export function unitsOf(kind: QuantityKind): string[] {
  const si = KIND_UNIT[kind]
  const rest = Object.entries(UNITS).filter(([word, info]) => info.kind === kind && word !== si).map(([word]) => word)
  return si === undefined ? rest : [si, ...rest]
}

/** True when the word is a prefix letter. */
export function isPrefix(word: string): boolean {
  return Object.prototype.hasOwnProperty.call(PREFIX_SCALES, word)
}

/** True when the word is a unit (SI or variant). */
export function isUnit(word: string): boolean {
  return Object.prototype.hasOwnProperty.call(UNITS, word)
}

/**
 * Split a unit word into its prefix scale and unit: `kohm` is `k` + `ohm`.
 *
 * A word arrives whole because letters run together when tokenizing, so the
 * split happens here. A prefix on its own is not a unit — `5k` names no quantity
 * — and `ohm`, which merely starts with a letter a prefix also uses, is one word.
 */
export function splitUnitWord(word: string): { scale: number; unit: string } | undefined {
  if (isUnit(word)) return { scale: 1, unit: word }
  const head = word.slice(0, 1)
  const tail = word.slice(1)
  if (isPrefix(head) && isUnit(tail)) return { scale: PREFIX_SCALES[head] as number, unit: tail }
  return undefined
}

/** The prefix letters, for a description that has to list them. */
export function prefixVocabulary(): string {
  return Object.keys(PREFIX_SCALES).join(' ')
}

/**
 * Every unit and variant word, for a description that has to list them. The
 * tables above are the only source of this vocabulary: a tool description that
 * spelled the words out itself would drift from the parser.
 */
export function unitVocabulary(): string {
  return Object.keys(UNITS).join(' ')
}
