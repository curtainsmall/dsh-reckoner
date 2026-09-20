/**
 * Dimensional algebra.
 *
 * Every kind maps to a vector of the seven SI base dimensions
 * `(kg, m, s, A, K, mol, cd)`. The evaluator carries the vector alongside the
 * number, so a formula is checked as it is computed: `@V/@R` is current, and a
 * result whose vector does not match the target slot's kind is refused before
 * anything is written.
 *
 * This is what replaces the argument checking a named-solver catalog used to do
 * — and it is stronger, because it checks the whole expression rather than one
 * call's arguments. There is no registry any more: the model writes the formula
 * and the engine answers with dimensions instead of a signature.
 *
 * A slot holds a `kind` (one of eighteen names), but a formula needs more room
 * than that: `(@V*@R2/(@R1+@R2))^2/(4*@Rth)` squares a voltage on the way to a
 * power, and `volt^2` has a perfectly good dimension with no name. So inside the
 * evaluator a value carries a `Measure` — the dimension vector, plus the kind
 * that names it when one does. `kind: null` means "a real dimension this engine
 * has no name for", which is allowed mid-formula and refused as a result: the
 * target slot needs a kind to pin.
 *
 * Three kinds are dimensionless but distinct, and the distinction matters:
 *
 * - `none` is a plain count. It multiplies any quantity without changing its
 *   dimension (`none × voltage = voltage`) and is the only kind allowed as an
 *   exponent.
 * - `angle` is dimensionless in SI (radian = 1) but is its own kind, so it can
 *   be added to another angle and nothing else.
 * - `log` is a plain ratio — decibels and the like.
 *
 * `none + voltage` is refused: that expression is genuinely ambiguous, and
 * refusing it is the whole point of having dimensions.
 */
import { QuantityKind } from '../math/quantity-kind.ts'
import { ToolError, ToolErrorCode } from '../errors.ts'

/** A vector of the seven SI base dimensions. */
export type Dimension = readonly [number, number, number, number, number, number, number]

/** kg · m · s · A · K · mol · cd */
const ZERO: Dimension = [0, 0, 0, 0, 0, 0, 0]

export const DIMENSIONS: Readonly<Record<string, Dimension>> = {
  // base quantities
  [QuantityKind.Time]: [0, 0, 1, 0, 0, 0, 0],
  [QuantityKind.Length]: [0, 1, 0, 0, 0, 0, 0],
  [QuantityKind.Mass]: [1, 0, 0, 0, 0, 0, 0],
  [QuantityKind.Current]: [0, 0, 0, 1, 0, 0, 0],
  [QuantityKind.Temperature]: [0, 0, 0, 0, 1, 0, 0],
  [QuantityKind.AmountOfSubstance]: [0, 0, 0, 0, 0, 1, 0],
  [QuantityKind.LuminousIntensity]: [0, 0, 0, 0, 0, 0, 1],
  // derived quantities
  [QuantityKind.Frequency]: [0, 0, -1, 0, 0, 0, 0],
  [QuantityKind.Resistance]: [1, 2, -3, -2, 0, 0, 0],
  [QuantityKind.Capacitance]: [-1, -2, 4, 2, 0, 0, 0],
  [QuantityKind.Inductance]: [1, 2, -2, -2, 0, 0, 0],
  [QuantityKind.Voltage]: [1, 2, -3, -1, 0, 0, 0],
  [QuantityKind.Power]: [1, 2, -3, 0, 0, 0, 0],
  [QuantityKind.Pressure]: [1, -1, -2, 0, 0, 0, 0],
  [QuantityKind.Energy]: [1, 2, -2, 0, 0, 0, 0],
  // dimensionless, each with its own identity
  [QuantityKind.Angle]: ZERO,
  [QuantityKind.Log]: ZERO,
  [QuantityKind.None]: ZERO,
}

/** The dimension vector of a kind. */
export function dimensionOf(kind: string): Dimension {
  const found = DIMENSIONS[kind]
  if (found === undefined) throw new ToolError(`unknown kind "${kind}"`, ToolErrorCode.Tool)
  return found
}

/** True when every component is zero. */
export function isDimensionless(value: Dimension): boolean {
  return value.every((component) => component === 0)
}

/** Component-wise equality. */
export function sameDimension(a: Dimension, b: Dimension): boolean {
  return a.every((component, index) => component === b[index])
}

/** Component-wise sum: multiplication of quantities. */
export function multiplyDimension(a: Dimension, b: Dimension): Dimension {
  return a.map((component, index) => component + (b[index] as number)) as unknown as Dimension
}

/** Component-wise difference: division of quantities. */
export function divideDimension(a: Dimension, b: Dimension): Dimension {
  return a.map((component, index) => component - (b[index] as number)) as unknown as Dimension
}

/** Render a vector the way an error message should show it. */
export function describeDimension(value: Dimension): string {
  const names = ['kg', 'm', 's', 'A', 'K', 'mol', 'cd']
  const parts: string[] = []
  value.forEach((exponent, index) => {
    if (exponent === 0) return
    parts.push(exponent === 1 ? (names[index] as string) : `${names[index]}^${exponent}`)
  })
  return parts.length === 0 ? 'dimensionless' : parts.join('·')
}

/**
 * Check that a value of `actual` kind may be used where `expected` is required.
 * Returns a message for the model, or undefined when it is acceptable.
 *
 * The rule is an exact kind match. Dimension vectors are what make the message
 * useful — they say *why* it was refused — but they are not a loophole: `angle`
 * and `none` are both dimensionless and are still different kinds.
 */
export function checkDimension(actual: string, expected: string): string | undefined {
  if (actual === expected) return undefined
  const a = dimensionOf(actual)
  const b = dimensionOf(expected)
  if (sameDimension(a, b)) {
    return `expected ${expected}, got ${actual} — both are dimensionless, but they are different kinds`
  }
  return `expected ${expected} (${describeDimension(b)}), got ${actual} (${describeDimension(a)})`
}

/* ── measures: a dimension, plus the kind that names it when one does ────── */

/**
 * What a value measures. `kind` is null for a dimension with no name — `volt^2`
 * is the honest example: a real dimension, no kind to pin a slot with.
 */
export interface Measure {
  readonly kind: string | null
  readonly dim: Dimension
}

/** The measure of a value stored under a known kind. */
export function measureOf(kind: string): Measure {
  return { kind, dim: dimensionOf(kind) }
}

/**
 * The measure of a dimension the engine has just computed. A dimensionless
 * result gets no name here: `none`, `angle` and `log` share the zero vector, so
 * only the operation that produced it can say which one it is.
 */
export function measureFromDimension(dim: Dimension): Measure {
  return { kind: kindForDimension(dim), dim }
}

/**
 * The kind whose dimension vector matches, if any does. The zero vector never
 * matches: three kinds share it, so a dimension-only answer would be a guess.
 */
export function kindForDimension(dim: Dimension): string | null {
  if (isDimensionless(dim)) return null
  for (const [kind, known] of Object.entries(DIMENSIONS)) {
    if (sameDimension(known, dim)) return kind
  }
  return null
}

/** Scale every component: `volt^2` is the voltage vector doubled. */
export function scaleDimension(value: Dimension, exponent: number): Dimension {
  return value.map((component) => component * exponent) as unknown as Dimension
}

/**
 * Why a logarithm may not be paired with a quantity, or undefined when it may.
 *
 * A logarithm is a ratio on a log scale, not a count: `log × voltage` would
 * silently invent a product out of a decibel reading, which is the same
 * ambiguity that makes `log + voltage` a refusal. `log × log`, `log × count` and
 * a logarithm on its own are all fine — they stay on the log scale.
 */
function logarithmProblem(a: Measure, b: Measure): string | undefined {
  if (a.kind === QuantityKind.Log && !isDimensionless(b.dim)) {
    return `cannot pair log with ${describeMeasure(b)} — a logarithm is a ratio on a log scale, not a count`
  }
  if (b.kind === QuantityKind.Log && !isDimensionless(a.dim)) {
    return `cannot pair ${describeMeasure(a)} with log — a logarithm is a ratio on a log scale, not a count`
  }
  return undefined
}

/**
 * The measure of `a × b`.
 *
 * A plain count is the "how many" multiplier and leaves the other side's
 * measure alone, which is what makes `2*@R` a resistance. Otherwise the
 * dimensions add and the result takes whatever name that dimension has —
 * `voltage × current` is a power, `voltage × voltage` is unnamed.
 */
export function multiplyMeasure(a: Measure, b: Measure): Measure {
  const problem = logarithmProblem(a, b)
  if (problem !== undefined) throw new ToolError(problem, ToolErrorCode.DimMismatch)
  const dim = multiplyDimension(a.dim, b.dim)
  if (isDimensionless(dim)) {
    if (a.kind === QuantityKind.None) return { kind: b.kind, dim }
    if (b.kind === QuantityKind.None) return { kind: a.kind, dim }
    if (a.kind !== null && a.kind === b.kind) return { kind: a.kind, dim }
    return { kind: null, dim }
  }
  return measureFromDimension(dim)
}

/**
 * The measure of `a / b`. Dividing by a plain count changes nothing; a
 * dimensionless quotient is a plain count, so `@V1/@V2` and `@R/@R` are ratios
 * rather than quantities.
 */
export function divideMeasure(a: Measure, b: Measure): Measure {
  const problem = logarithmProblem(a, b)
  if (problem !== undefined) throw new ToolError(problem, ToolErrorCode.DimMismatch)
  const dim = divideDimension(a.dim, b.dim)
  if (isDimensionless(dim)) return { kind: QuantityKind.None, dim }
  return measureFromDimension(dim)
}

/**
 * The measure of `a ^ n`, where `n` is a plain number. The dimension scales with
 * the exponent, so `(4ohm)^1` is a resistance, `(4ohm)^0` is a count, and
 * `(4ohm)^2` is an unnamed dimension — legal mid-formula, refused as a result.
 */
export function powerMeasure(a: Measure, exponent: number): Measure {
  if (exponent === 0) return { kind: QuantityKind.None, dim: ZERO }
  if (exponent === 1) return a
  const dim = scaleDimension(a.dim, exponent)
  if (isDimensionless(dim)) return { kind: a.kind, dim }
  return measureFromDimension(dim)
}

/**
 * Why `a + b` (or `a - b`, or `$min`) is refused, or undefined when it is
 * allowed.
 *
 * Addition is where dimensions earn their keep: `none + voltage` is genuinely
 * ambiguous (is the bare number volts?) and is refused, while `angle + angle`
 * and `voltage + voltage` are fine. Two unnamed measures of the same dimension
 * add up, since there is nothing ambiguous about `volt^2 + volt^2`.
 */
export function addableMeasure(a: Measure, b: Measure, verb = 'add'): string | undefined {
  if (!sameDimension(a.dim, b.dim)) {
    // A bare count next to a quantity is the common mistake: 5 + @V_in does not
    // say whether the 5 is volts, so it is refused with the reason that matters.
    if (isDimensionless(a.dim) && a.kind === QuantityKind.None) {
      return `cannot ${verb} a plain count to ${describeMeasure(b)} — write the count with its unit (for example 5volt), or multiply if that is what you mean`
    }
    if (isDimensionless(b.dim) && b.kind === QuantityKind.None) {
      return `cannot ${verb} a plain count to ${describeMeasure(a)} — write the count with its unit (for example 5volt), or multiply if that is what you mean`
    }
    return `cannot ${verb} ${describeMeasure(a)} and ${describeMeasure(b)} — their dimensions differ`
  }
  if (a.kind !== null && b.kind !== null && a.kind !== b.kind) {
    return `cannot ${verb} ${a.kind} and ${b.kind} — both are dimensionless, but they are different kinds`
  }
  return undefined
}

/** How a measure reads in an error message. */
export function describeMeasure(value: Measure): string {
  const dimension = describeDimension(value.dim)
  if (value.kind !== null) return value.kind === dimension ? value.kind : `${value.kind} (${dimension})`
  return isDimensionless(value.dim) ? 'a dimensionless value with no kind' : `an unnamed ${dimension}`
}
