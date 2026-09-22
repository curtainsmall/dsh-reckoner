/**
 * The evaluator: dimensions and numbers travel together, so every rule here
 * is two rules at once - what the numbers do, and what their SI vectors do.
 * An intermediate may carry a fractional vector; only a slot refuses one.
 */
import { fail } from '../errors.ts'
import type { AccessExpression, CallExpression, Expression } from './formula-parser.ts'
import { notationLookup, type NotationEntry } from './notation.ts'
import {
  ZERO_SI_VECTOR,
  type SiVector,
  addSiVectors,
  formatSiVector,
  isZeroSiVector,
  kindOfSiVector,
  scaleSiVector,
  siVectorsEqual,
  subtractSiVectors,
} from './si-vector.ts'
import { type ArrayValue, type Scalar, type Value, collectArray, complexValue, realValue } from './value.ts'

type ScalarValue = Value & ({ kind: 'number' } | { kind: 'complex' })

/** What the evaluator reads from outside: slot values, and which slots a formula actually read. */
export interface SlotAccess {
  read(name: string): Value | undefined
  note(name: string): void
}

/** A value as a message names it: the number and its vector, never a long dump. */
function summary(value: Value): string {
  if (value.kind === 'object') return `an object with the fields ${Object.keys(value.fields).join(', ') || '(none)'}`
  const vector = `${formatSiVector(value.dim)} (${kindOfSiVector(value.dim)})`
  if (value.kind === 'array') return `an array of ${value.items.length} element(s) with the SI vector ${vector}`
  if (value.kind === 'complex') return `the complex number ${value.re}${value.im < 0 ? '-' : '+'}${Math.abs(value.im)}j with the SI vector ${vector}`
  return `the number ${value.num} with the SI vector ${vector}`
}

function scalarOf(value: ScalarValue): Scalar {
  return value.kind === 'number' ? { re: value.num, im: 0 } : { re: value.re, im: value.im }
}

function addScalars(left: Scalar, right: Scalar): Scalar {
  return { re: left.re + right.re, im: left.im + right.im }
}

function subtractScalars(left: Scalar, right: Scalar): Scalar {
  return { re: left.re - right.re, im: left.im - right.im }
}

function multiplyScalars(left: Scalar, right: Scalar): Scalar {
  return { re: left.re * right.re - left.im * right.im, im: left.re * right.im + left.im * right.re }
}

function divideScalars(left: Scalar, right: Scalar): Scalar {
  if (right.re === 0 && right.im === 0) {
    fail('ENGINE_RANGE_DOMAIN', 'division by zero: the divisor is 0. Check the denominator of this step, and remember that a denominator may be zero for one value of a bound variable.')
  }
  const denominator = right.re * right.re + right.im * right.im
  return { re: (left.re * right.re + left.im * right.im) / denominator, im: (left.im * right.re - left.re * right.im) / denominator }
}

function magnitude(scalar: Scalar): number {
  return Math.hypot(scalar.re, scalar.im)
}

/** The principal logarithm: ln|z| + i*arg(z). */
function complexLog(scalar: Scalar): Scalar {
  if (scalar.re === 0 && scalar.im === 0) {
    fail('ENGINE_RANGE_DOMAIN', '$ln of 0 is not defined; the logarithm needs a value greater than 0.')
  }
  return { re: Math.log(magnitude(scalar)), im: Math.atan2(scalar.im, scalar.re) }
}

function complexExp(scalar: Scalar): Scalar {
  const scale = Math.exp(scalar.re)
  return { re: scale * Math.cos(scalar.im), im: scale * Math.sin(scalar.im) }
}

function complexSqrt(scalar: Scalar): Scalar {
  const root = Math.sqrt(magnitude(scalar))
  const half = Math.atan2(scalar.im, scalar.re) / 2
  return { re: root * Math.cos(half), im: root * Math.sin(half) }
}

class Evaluator {
  private readonly scopes: Array<Map<string, Value>> = []

  constructor(private readonly slots: SlotAccess) {}

  evaluate(expression: Expression): Value {
    if (expression.kind === 'scalar') {
      return expression.scalar.im === 0
        ? realValue(expression.scalar.re)
        : complexValue(expression.scalar.re, expression.scalar.im, ZERO_SI_VECTOR)
    }
    if (expression.kind === 'binding') {
      for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
        const found = this.scopes[index]?.get(expression.name)
        if (found !== undefined) return found
      }
      return fail(
        'ENGINE_IDENT_UNBOUND',
        `the name "${expression.name}" is not bound here: a bare name is a bound variable only ($sum_{k=a}^{b}(body) binds k). To read a slot write @${expression.name}.`,
      )
    }
    if (expression.kind === 'slot') {
      const value = this.slots.read(expression.name)
      if (value === undefined) {
        return fail(
          'ENGINE_SLOT_UNDECLARED',
          `the slot "${expression.name}" does not exist yet. Declare it first with set {name:"${expression.name}", value:{num:..., dim:...}}.`,
        )
      }
      this.slots.note(expression.name)
      return value
    }
    if (expression.kind === 'access') return this.access(expression)
    if (expression.kind === 'call') return this.call(expression)
    if (expression.kind === 'unary') {
      const operand = this.evaluate(expression.operand)
      if (expression.operator === '+') return operand
      return this.mapUnary('negation', operand, (scalar, dim, like) => this.resultScalar({ re: -scalar.re, im: -scalar.im }, dim, like))
    }
    const left = this.evaluate(expression.left)
    const right = this.evaluate(expression.right)
    return this.binary(expression.operator, left, right)
  }

  private access(expression: AccessExpression): Value {
    const base = this.evaluate(expression.base)
    if (expression.member.kind === 'field') {
      if (base.kind !== 'object') {
        fail('ENGINE_NOT_INDEXABLE', `"." reads a field of an object, but this value is ${summary(base)}. Object fields are read as @name.field.`)
      }
      const field = base.fields[expression.member.name]
      if (field === undefined) {
        const fields = Object.keys(base.fields)
        fail(
          'ENGINE_NO_FIELD',
          `the object has no field "${expression.member.name}"; its fields are ${fields.length === 0 ? '(none)' : fields.join(', ')}.`,
        )
      }
      return field
    }
    if (base.kind !== 'array') {
      fail('ENGINE_NOT_INDEXABLE', `"[ ]" takes an element of an array, but this value is ${summary(base)}. Only arrays are indexed.`)
    }
    const index = this.integerValue(this.evaluate(expression.member.index), 'an array index')
    if (index < 0 || index >= base.items.length) {
      fail(
        'ENGINE_RANGE_INDEX',
        `the index ${index} is outside the array, which has ${base.items.length} element(s); the valid indices are 0..${base.items.length - 1}.`,
      )
    }
    return base.items[index]!
  }

  private integerValue(value: Value, what: string): number {
    if (value.kind === 'number' && isZeroSiVector(value.dim) && Number.isInteger(value.num)) return value.num
    if (value.kind === 'complex' && isZeroSiVector(value.dim) && value.im === 0 && Number.isInteger(value.re)) return value.re
    fail(
      'ENGINE_RANGE_INDEX',
      `${what} must be an integer with the zero SI vector; got ${summary(value)}. Use an integer expression such as 0, $len(@a)-1, or a dimensionless slot.`,
    )
  }

  private mapUnary(what: string, value: Value, apply: (scalar: Scalar, dim: SiVector, like: ScalarValue) => Value): Value {
    if (value.kind === 'object') {
      fail('ENGINE_TYPE_NOT_ARITHMETIC', `${what} is not defined on an object, which has one dimension per field; read a field first, as in @name.field.`)
    }
    if (value.kind === 'array') {
      return collectArray(value.items.map((item) => this.mapUnary(what, item, apply)), what)
    }
    return apply(scalarOf(value), value.dim, value)
  }

  private resultScalar(scalar: Scalar, dim: SiVector, ...likes: ScalarValue[]): ScalarValue {
    const complex = scalar.im !== 0 || likes.some((like) => like.kind === 'complex')
    return complex ? complexValue(scalar.re, scalar.im, dim) : realValue(scalar.re, dim)
  }

  private binary(operator: '+' | '-' | '*' | '/' | '^', left: Value, right: Value): Value {
    if (left.kind === 'object' || right.kind === 'object') {
      fail(
        'ENGINE_TYPE_NOT_ARITHMETIC',
        `"${operator}" is not defined on an object, which has one dimension per field; read the field you need first, as in @name.field.`,
      )
    }
    if (left.kind === 'array' && right.kind === 'array') {
      if (left.items.length !== right.items.length) {
        fail(
          'ENGINE_ARGS_INVALID',
          `"${operator}" needs two arrays of the same length, but they have ${left.items.length} and ${right.items.length} element(s). Build them with the same bounds, or index one explicitly.`,
        )
      }
      return collectArray(left.items.map((item, index) => this.binary(operator, item, right.items[index]!)), `"${operator}"`)
    }
    if (left.kind === 'array') return collectArray(left.items.map((item) => this.binary(operator, item, right)), `"${operator}"`)
    if (right.kind === 'array') return collectArray(right.items.map((item) => this.binary(operator, left, item)), `"${operator}"`)
    if (operator === '^') return this.power(left, right)
    const a = scalarOf(left)
    const b = scalarOf(right)
    if (operator === '+' || operator === '-') {
      if (!siVectorsEqual(left.dim, right.dim)) {
        fail(
          'ENGINE_DIM_MISMATCH',
          `"${operator}" needs both sides to carry the same SI vector, but the left is ${formatSiVector(left.dim)} (${kindOfSiVector(left.dim)}) and the right is ${formatSiVector(right.dim)} (${kindOfSiVector(right.dim)}). A plain count is not a quantity: if one side is a bare number, give it the other side's dimension, or multiply instead of adding.`,
        )
      }
      const result = operator === '+' ? addScalars(a, b) : subtractScalars(a, b)
      return this.resultScalar(result, left.dim, left, right)
    }
    if (operator === '*') {
      return this.resultScalar(multiplyScalars(a, b), addSiVectors(left.dim, right.dim), left, right)
    }
    return this.resultScalar(divideScalars(a, b), subtractSiVectors(left.dim, right.dim), left, right)
  }

  private power(base: ScalarValue, exponent: ScalarValue): ScalarValue {
    if (!isZeroSiVector(exponent.dim)) {
      fail(
        'ENGINE_DIM_MISMATCH',
        `an exponent must be dimensionless (the zero SI vector), but it is ${formatSiVector(exponent.dim)} (${kindOfSiVector(exponent.dim)}).`,
      )
    }
    const b = scalarOf(base)
    const e = scalarOf(exponent)

    if (e.im !== 0) {
      if (!isZeroSiVector(base.dim)) {
        fail(
          'ENGINE_DIM_MISMATCH',
          `a complex exponent needs a dimensionless base, because a^z is exp(z*Log a); the base is ${formatSiVector(base.dim)} (${kindOfSiVector(base.dim)}).`,
        )
      }
      if (b.re === 0 && b.im === 0) {
        fail('ENGINE_RANGE_DOMAIN', '0 raised to a complex power is not defined; the base of a complex power must be non-zero.')
      }
      return complexValue(...asTuple(complexExp(multiplyScalars(e, complexLog(b)))), ZERO_SI_VECTOR)
    }

    const exponentValue = e.re
    const dim = scaleSiVector(base.dim, exponentValue)

    if (b.im !== 0) {
      if (b.re === 0 && exponentValue === 0) return complexValue(1, 0, dim)
      if (b.re === 0) {
        fail('ENGINE_RANGE_DOMAIN', `0 raised to the negative power ${exponentValue} is not defined; a denominator must not be zero.`)
      }
      const radius = magnitude(b) ** exponentValue
      const angle = Math.atan2(b.im, b.re) * exponentValue
      return complexValue(radius * Math.cos(angle), radius * Math.sin(angle), dim)
    }

    if (b.re === 0) {
      if (exponentValue === 0) return realValue(1, dim)
      if (exponentValue < 0) {
        fail('ENGINE_RANGE_DOMAIN', `0 raised to the negative power ${exponentValue} is not defined; a denominator must not be zero.`)
      }
      return realValue(0, dim)
    }

    if (b.re < 0 && !Number.isInteger(exponentValue)) {
      fail(
        'ENGINE_RANGE_DOMAIN',
        `the negative base ${b.re} with the fractional exponent ${exponentValue} has no real value. Use an integer exponent, or write the principal complex value with $j.`,
      )
    }
    const powered = Math.abs(b.re) ** exponentValue
    const negative = b.re < 0 && Math.abs(exponentValue % 2) === 1
    const result = negative ? -powered : powered
    return base.kind === 'complex' || exponent.kind === 'complex' ? complexValue(result, 0, dim) : realValue(result, dim)
  }

  private call(expression: CallExpression): Value {
    const entry = notationLookup(expression.symbol)
    if (entry === undefined) {
      fail('ENGINE_TOOL', `internal: the parser accepted the unknown notation "${expression.symbol}".`)
    }
    if (entry.notationClass === 'binding') return this.bindingCall(expression, entry)
    if (entry.notationClass === 'constant') return this.constant(expression.symbol)
    const first = expression.args[0]
    if (first === undefined) fail('ENGINE_TOOL', `internal: "${expression.symbol}" was parsed without arguments.`)
    const left = this.evaluate(first)
    if (expression.args.length === 1) return this.unaryFunction(expression.symbol, left)
    const second = expression.args[1]!
    return this.binaryFunction(expression.symbol, left, this.evaluate(second))
  }

  private constant(symbol: string): Value {
    if (symbol === '$pi') return realValue(Math.PI)
    if (symbol === '$e') return realValue(Math.E)
    if (symbol === '$inf') return realValue(Number.POSITIVE_INFINITY)
    return complexValue(0, 1, ZERO_SI_VECTOR)
  }

  private requireZeroDim(symbol: string, dim: SiVector): void {
    if (isZeroSiVector(dim)) return
    fail(
      'ENGINE_DIM_MISMATCH',
      `"${symbol}" takes a dimensionless argument (the zero SI vector, as radian is), but it got ${formatSiVector(dim)} (${kindOfSiVector(dim)}). Divide the quantity by its unit first - for degrees use @x*$pi/180.`,
    )
  }

  private requireReal(symbol: string, scalar: Scalar): void {
    if (scalar.im === 0) return
    fail('ENGINE_RANGE_DOMAIN', `"${symbol}" is defined for real numbers, but it got the complex number ${scalar.re}+${scalar.im}j.`)
  }

  private unaryFunction(symbol: string, value: Value): Value {
    if (value.kind === 'object') {
      fail('ENGINE_TYPE_NOT_ARITHMETIC', `"${symbol}" is not defined on an object, which has one dimension per field; read a field first, as in @name.field.`)
    }
    if (value.kind === 'array') {
      if (symbol === '$transpose') return this.transpose(value)
      if (symbol === '$len') return realValue(value.items.length)
      return collectArray(value.items.map((item) => this.unaryFunction(symbol, item)), symbol)
    }
    const scalar = scalarOf(value)
    const dim = value.dim

    switch (symbol) {
      case '$abs':
        return realValue(magnitude(scalar), dim)
      case '$re':
        return realValue(scalar.re, dim)
      case '$im':
        return realValue(scalar.im, dim)
      case '$conj':
        return this.resultScalar({ re: scalar.re, im: -scalar.im }, dim, value)
      case '$arg':
        return realValue(Math.atan2(scalar.im, scalar.re), ZERO_SI_VECTOR)
      case '$sqrt': {
        const half = scaleSiVector(dim, 0.5)
        if (scalar.im === 0) {
          if (scalar.re < 0) {
            fail('ENGINE_RANGE_DOMAIN', `$sqrt of the negative number ${scalar.re} has no real value; write $j*$sqrt(${-scalar.re}) for the imaginary root.`)
          }
          return realValue(Math.sqrt(scalar.re), half)
        }
        return this.resultScalar(complexSqrt(scalar), half, value)
      }
      case '$exp':
        this.requireZeroDim(symbol, dim)
        return scalar.im === 0 ? realValue(Math.exp(scalar.re)) : complexValue(...asTuple(complexExp(scalar)), ZERO_SI_VECTOR)
      case '$ln': {
        this.requireZeroDim(symbol, dim)
        if (scalar.im === 0 && scalar.re <= 0) {
          fail('ENGINE_RANGE_DOMAIN', `$ln of ${scalar.re} is not defined: the logarithm needs a value greater than 0.`)
        }
        const result = complexLog(scalar)
        return scalar.im === 0 ? realValue(result.re) : complexValue(result.re, result.im, ZERO_SI_VECTOR)
      }
      case '$log': {
        this.requireZeroDim(symbol, dim)
        if (scalar.im === 0 && scalar.re <= 0) {
          fail('ENGINE_RANGE_DOMAIN', `$log of ${scalar.re} is not defined: the base-10 logarithm needs a value greater than 0.`)
        }
        const result = complexLog(scalar)
        return scalar.im === 0 ? realValue(result.re / Math.LN10) : complexValue(result.re / Math.LN10, result.im / Math.LN10, ZERO_SI_VECTOR)
      }
      case '$sin':
      case '$cos':
      case '$tan': {
        this.requireZeroDim(symbol, dim)
        const result = trigonometric(symbol, scalar)
        return scalar.im === 0 ? realValue(result.re) : complexValue(result.re, result.im, ZERO_SI_VECTOR)
      }
      case '$asin':
      case '$acos':
      case '$atan': {
        this.requireZeroDim(symbol, dim)
        const result = inverseTrigonometric(symbol, scalar)
        return scalar.im === 0 ? realValue(result.re) : complexValue(result.re, result.im, ZERO_SI_VECTOR)
      }
      case '$floor':
      case '$ceil':
      case '$sign': {
        this.requireZeroDim(symbol, dim)
        this.requireReal(symbol, scalar)
        if (symbol === '$floor') return realValue(Math.floor(scalar.re))
        if (symbol === '$ceil') return realValue(Math.ceil(scalar.re))
        return realValue(Math.sign(scalar.re))
      }
      case '$len':
        fail('ENGINE_ARGS_INVALID', `$len takes an array and counts its elements; got ${summary(value)}.`)
      case '$transpose':
        fail('ENGINE_ARGS_INVALID', `$transpose takes a two-dimensional array; got ${summary(value)}.`)
      default:
        return fail('ENGINE_TOOL', `internal: "${symbol}" has no implementation.`)
    }
  }

  private transpose(value: ArrayValue): Value {
    const first = value.items[0]
    if (first === undefined || first.kind !== 'array') {
      fail('ENGINE_ARGS_INVALID', `$transpose takes a two-dimensional array; this array's element is ${first === undefined ? 'missing' : summary(first)}.`)
    }
    const width = first.items.length
    for (const row of value.items) {
      if (row.kind !== 'array' || row.items.length !== width) {
        fail(
          'ENGINE_ARGS_INVALID',
          `$transpose needs a rectangular two-dimensional array, but its rows have different lengths (${width} and ${row.kind === 'array' ? row.items.length : 'not an array'}).`,
        )
      }
    }
    const rows = value.items as readonly ArrayValue[]
    const columns: Value[] = []
    for (let column = 0; column < width; column += 1) {
      columns.push(collectArray(rows.map((row) => row.items[column]!), '$transpose'))
    }
    return collectArray(columns, '$transpose')
  }

  private binaryFunction(symbol: string, left: Value, right: Value): Value {
    if (left.kind === 'object' || right.kind === 'object') {
      fail('ENGINE_TYPE_NOT_ARITHMETIC', `"${symbol}" is not defined on an object, which has one dimension per field; read a field first, as in @name.field.`)
    }
    if (left.kind === 'array' && right.kind === 'array') {
      if (left.items.length !== right.items.length) {
        fail(
          'ENGINE_ARGS_INVALID',
          `"${symbol}" needs two arrays of the same length, but they have ${left.items.length} and ${right.items.length} element(s).`,
        )
      }
      return collectArray(left.items.map((item, index) => this.binaryFunction(symbol, item, right.items[index]!)), symbol)
    }
    if (left.kind === 'array') return collectArray(left.items.map((item) => this.binaryFunction(symbol, item, right)), symbol)
    if (right.kind === 'array') return collectArray(right.items.map((item) => this.binaryFunction(symbol, left, item)), symbol)

    if (!siVectorsEqual(left.dim, right.dim)) {
      fail(
        'ENGINE_DIM_MISMATCH',
        `"${symbol}" needs both arguments to carry the same SI vector, but they are ${formatSiVector(left.dim)} (${kindOfSiVector(left.dim)}) and ${formatSiVector(right.dim)} (${kindOfSiVector(right.dim)}).`,
      )
    }
    const a = scalarOf(left)
    const b = scalarOf(right)
    this.requireReal(symbol, a)
    this.requireReal(symbol, b)

    if (symbol === '$atan2') return realValue(Math.atan2(a.re, b.re), ZERO_SI_VECTOR)
    if (symbol === '$min') return realValue(Math.min(a.re, b.re), left.dim)
    if (symbol === '$max') return realValue(Math.max(a.re, b.re), left.dim)
    if (b.re === 0) {
      fail('ENGINE_RANGE_DOMAIN', `$mod by zero is not defined; the divisor is 0.`)
    }
    return realValue(a.re % b.re, left.dim)
  }

  private bindingCall(expression: CallExpression, entry: NotationEntry): Value {
    if (!entry.evaluable) {
      fail(
        'ENGINE_SYMBOL_NOT_EVALUABLE',
        `"${entry.symbol}" cannot be evaluated; write ${entry.form} and evaluate a closed form instead.`,
      )
    }
    const binder = expression.binder
    const body = expression.args[0]
    const until = expression.until
    if (binder === undefined || body === undefined || until === undefined) {
      fail('ENGINE_TOOL', `internal: "${entry.symbol}" was parsed without its bounds.`)
    }
    const from = this.integerValue(this.evaluate(binder.from), `the lower bound of "${entry.symbol}"`)
    const to = this.integerValue(this.evaluate(until), `the upper bound of "${entry.symbol}"`)
    if (from > to) {
      fail(
        'ENGINE_RANGE_INDEX',
        `the bounds of "${entry.symbol}" are ${from} (lower) and ${to} (upper); the lower bound must not be greater than the upper one.`,
      )
    }
    const collected: Value[] = []
    for (let step = from; step <= to; step += 1) {
      this.scopes.push(new Map([[binder.variable, realValue(step)]]))
      try {
        collected.push(this.evaluate(body))
      } finally {
        this.scopes.pop()
      }
    }
    if (entry.symbol === '$seq') return collectArray(collected, '$seq')
    let accumulator = collected[0]!
    for (const value of collected.slice(1)) {
      accumulator = this.binary(entry.symbol === '$sum' ? '+' : '*', accumulator, value)
    }
    return accumulator
  }
}

function asTuple(scalar: Scalar): [number, number] {
  return [scalar.re, scalar.im]
}

function trigonometric(symbol: string, scalar: Scalar): Scalar {
  if (scalar.im === 0) {
    if (symbol === '$sin') return { re: Math.sin(scalar.re), im: 0 }
    if (symbol === '$cos') return { re: Math.cos(scalar.re), im: 0 }
    return { re: Math.tan(scalar.re), im: 0 }
  }
  const sin = { re: Math.sin(scalar.re) * Math.cosh(scalar.im), im: Math.cos(scalar.re) * Math.sinh(scalar.im) }
  const cos = { re: Math.cos(scalar.re) * Math.cosh(scalar.im), im: -Math.sin(scalar.re) * Math.sinh(scalar.im) }
  if (symbol === '$sin') return sin
  if (symbol === '$cos') return cos
  return divideScalars(sin, cos)
}

function inverseTrigonometric(symbol: string, scalar: Scalar): Scalar {
  if (scalar.im === 0) {
    if (symbol === '$asin') {
      if (scalar.re < -1 || scalar.re > 1) {
        fail('ENGINE_RANGE_DOMAIN', `$asin of ${scalar.re} is not defined: the arcsine needs a value between -1 and 1.`)
      }
      return { re: Math.asin(scalar.re), im: 0 }
    }
    if (symbol === '$acos') {
      if (scalar.re < -1 || scalar.re > 1) {
        fail('ENGINE_RANGE_DOMAIN', `$acos of ${scalar.re} is not defined: the arccosine needs a value between -1 and 1.`)
      }
      return { re: Math.acos(scalar.re), im: 0 }
    }
    return { re: Math.atan(scalar.re), im: 0 }
  }
  const i = { re: 0, im: 1 }
  const one = { re: 1, im: 0 }
  if (symbol === '$atan') {
    const ratio = divideScalars(addScalars(i, scalar), subtractScalars(i, scalar))
    const logged = complexLog(ratio)
    return multiplyScalars({ re: 0, im: 0.5 }, logged)
  }
  const inside = addScalars(multiplyScalars(i, scalar), complexSqrt(subtractScalars(one, multiplyScalars(scalar, scalar))))
  const logged = complexLog(inside)
  const asin = multiplyScalars({ re: 0, im: -1 }, logged)
  if (symbol === '$asin') return asin
  return subtractScalars({ re: Math.PI / 2, im: 0 }, asin)
}

/** Evaluate one parsed formula against the slots it reads. */
export function evaluateFormula(expression: Expression, slots: SlotAccess): Value {
  return new Evaluator(slots).evaluate(expression)
}
