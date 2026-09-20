/**
 * The formula kernel: parse and evaluate ONE expression.
 *
 * A formula is a single expression. There is no assignment inside it — `@name`
 * READS a slot, and the caller decides the slot a result is written to. Bare
 * identifiers are binding variables introduced by `$sum` / `$prod` / `$seq` /
 * `$diff` / `$integral` / `$limit`; anything else is unbound and refused.
 *
 * The parser evaluates as it descends, so there is no separate AST: grammar and
 * evaluation are one pass. What travels with each number is a `Measure` — the
 * dimension vector, plus the kind that names it when one does. That is why
 * `(@V)^2/@R` works: `volt^2` is a real dimension with no name, and the division
 * brings it back to `power`. Only the RESULT has to be a named kind, because a
 * slot pins one.
 *
 * Arrays are element-wise: both sides must have the same length, elements are
 * combined one by one, and a scalar broadcasts. There is no matrix algebra —
 * `$seq` builds the arrays and the formula walks them with `[...]`.
 */
import { ToolError, ToolErrorCode } from '../errors.ts'
import { QuantityKind } from '../math/quantity-kind.ts'
import {
  type Measure,
  addableMeasure,
  describeMeasure,
  isDimensionless,
  measureOf,
  multiplyMeasure,
  divideMeasure,
  powerMeasure,
} from './dimension.ts'
import { parseValueString } from './parse-value.ts'
import { SYMBOLS, SymbolForm, symbolVocabulary } from './notation.ts'
import { isPrefix, isUnit } from './units.ts'
import type { TypedValue } from './values.ts'

/** What a formula needs from the engine: the slot table. */
export interface EvalContext {
  /** Read one slot, or undefined when it is not declared. */
  readSlot(name: string): TypedValue | undefined
  /** The slots the formula actually read, in first-use order. */
  readonly used: Map<string, TypedValue>
}

/** A value mid-formula: every number carries its measure. */
type Evaluated =
  | { type: 'number'; value: number; measure: Measure }
  | { type: 'complex'; value: { re: number; im: number }; measure: Measure }
  | { type: 'string'; value: string }
  | { type: 'array'; value: Evaluated[] }
  | { type: 'object'; value: Record<string, Evaluated> }

/** A number or complex mid-formula: the shapes the arithmetic works on. */
type Measured = Extract<Evaluated, { type: 'number' | 'complex' }>

const NONE = QuantityKind.None as string

/** The complex payload of a measured value. */
function parts(value: Measured): { re: number; im: number } {
  return value.type === 'number' ? { re: value.value, im: 0 } : value.value
}

/** Build a number when the imaginary part is zero, else a complex. */
function measured(re: number, im: number, measure: Measure): Measured {
  if (im === 0) return { type: 'number', value: re, measure }
  return { type: 'complex', value: { re, im }, measure }
}

function isMeasured(value: Evaluated): value is Measured {
  return value.type === 'number' || value.type === 'complex'
}

/** A short description of a value for an error message. */
function describe(value: Evaluated): string {
  if (isMeasured(value)) return `${parts(value).re} ${describeMeasure(value.measure)}`
  if (value.type === 'object') return 'an object'
  if (value.type === 'array') return `an array of ${value.value.length}`
  return `a ${value.type}`
}

/**
 * Parse a quantity literal. The value parser owns the unit vocabulary and its
 * refusals, so its message is reused verbatim — only the character position is
 * rebased from the literal onto the formula the model wrote.
 */
function parseLiteral(text: string, at: number): TypedValue {
  try {
    return parseValueString(text)
  } catch (error) {
    if (!(error instanceof ToolError)) throw error
    const rebased = error.message.replace(/^character (\d+):/, (_match, digit: string) => `character ${Number(digit) + at}:`)
    throw new ToolError(rebased, error.code)
  }
}

/**
 * A value read from a slot, in the form the evaluator works with. A slot always
 * has a kind, so this is where a name becomes a measure.
 */
function fromStored(value: TypedValue): Evaluated {
  switch (value.type) {
    case 'number':
      return { type: 'number', value: value.value, measure: measureOf(value.kind) }
    case 'complex':
      return { type: 'complex', value: value.value, measure: measureOf(value.kind) }
    case 'string':
      return { type: 'string', value: value.value }
    case 'array':
      return { type: 'array', value: value.value.map(fromStored) }
    case 'object':
      return { type: 'object', value: Object.fromEntries(Object.entries(value.value).map(([key, field]) => [key, fromStored(field)])) }
  }
}

/**
 * The kind a result must have before it can be stored. An unnamed dimension is
 * legal inside a formula and refused here, with the dimension named so the model
 * can see what it computed: `(4ohm)^2` measures a real thing this engine has no
 * kind for, and saying so is more useful than pinning it as a resistance.
 */
function kindOf(measure: Measure): string {
  if (measure.kind !== null) return measure.kind
  throw new ToolError(
    `the result measures ${describeMeasure(measure)}, which no kind names — split the formula so each step lands on a named quantity`,
    ToolErrorCode.DimMismatch,
  )
}

/** A value on its way to a slot, a trace row or a nested value. */
function toStored(value: Evaluated): TypedValue {
  switch (value.type) {
    case 'number':
      return { type: 'number', value: value.value, kind: kindOf(value.measure) as QuantityKind }
    case 'complex':
      return { type: 'complex', value: value.value, kind: kindOf(value.measure) as QuantityKind }
    case 'string':
      return { type: 'string', value: value.value }
    case 'array':
      return { type: 'array', value: value.value.map(toStored) }
    case 'object':
      return { type: 'object', value: Object.fromEntries(Object.entries(value.value).map(([key, field]) => [key, toStored(field)])) }
  }
}

/** What a `_{...}` or `^{...}` position holds. */
type Position =
  /** A bare identifier: `x` in `$limit_{x->a}`. */
  | { kind: 'name'; text: string }
  /** An expression: `0` in `$seq_{k=0}^{M-1}(...)`. */
  | { kind: 'value'; value: Evaluated }
  /** A binding variable and its lower bound: `k=a`. */
  | { kind: 'bind'; name: string; from: Evaluated }

/** Element-wise combination of two values, recursing into arrays. */
function elementwise(
  a: Evaluated,
  b: Evaluated,
  combine: (x: Evaluated, y: Evaluated) => Evaluated,
  position: string,
): Evaluated {
  if (a.type === 'array' && b.type === 'array') {
    if (a.value.length !== b.value.length) {
      throw new ToolError(
        `${position}: arrays must have the same length, got ${a.value.length} and ${b.value.length}`,
        ToolErrorCode.ArgsInvalid,
      )
    }
    return { type: 'array', value: a.value.map((item, index) => combine(item, b.value[index] as Evaluated)) }
  }
  if (a.type === 'array') return { type: 'array', value: a.value.map((item) => combine(item, b)) }
  if (b.type === 'array') return { type: 'array', value: b.value.map((item) => combine(a, item)) }
  return combine(a, b)
}

/* ── tokenizer ───────────────────────────────────────────────────────────── */

type Token =
  | { kind: 'number'; text: string; at: number }
  | { kind: 'name'; text: string; at: number }
  | { kind: 'string'; text: string; at: number }
  | { kind: 'dollar'; at: number }
  | { kind: 'slot'; at: number }
  | { kind: 'punct'; text: string; at: number }

const PUNCT = ['+', '-', '*', '/', '^', '(', ')', '[', ']', '{', '}', ',', ':', '.', '_', '=', '->']

function isLetter(ch: string | undefined): boolean {
  return ch !== undefined && ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z'))
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9'
}

function isNameChar(ch: string | undefined): boolean {
  return isLetter(ch) || isDigit(ch) || ch === '_'
}

/**
 * Split the source at every token boundary.
 *
 * `_` plays two roles and the following character decides which: inside a name
 * it is a name character (`@V_out`), and where it follows a word it is the
 * subscript position (`$sum_{k=a}`). So a name ends at a `_` that is not itself
 * followed by a name character.
 *
 * A number swallows the word attached to it (`4.7kohm`, `25degC`, `2j`): the
 * value parser owns the unit vocabulary, so the whole literal is handed to it
 * and its refusals — `4.7kiloohm`, `5k` — are the ones the model sees.
 */
function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < source.length) {
    const ch = source[i] as string
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1
      continue
    }
    if (isDigit(ch) || (ch === '.' && isDigit(source[i + 1]))) {
      const at = i
      while (isDigit(source[i])) i += 1
      if (source[i] === '.') {
        i += 1
        while (isDigit(source[i])) i += 1
      }
      if (source[i] === 'e' || source[i] === 'E') {
        if (source[i] === 'E') {
          throw new ToolError(
            `character ${i + 1}: scientific notation takes a lowercase 'e' — write "${source.slice(at, i)}e${source.slice(i + 1)}"`,
            ToolErrorCode.ParseNumber,
          )
        }
        const save = i
        i += 1
        if (source[i] === '+' || source[i] === '-') i += 1
        if (isDigit(source[i])) {
          while (isDigit(source[i])) i += 1
        } else {
          i = save
          throw new ToolError(
            `character ${save + 1}: 'e' must be followed by digits (as in 1e5); to multiply by e write "2*e"`,
            ToolErrorCode.ParseNumber,
          )
        }
      }
      // The unit word, or the imaginary suffix, that follows immediately.
      while (isNameChar(source[i])) i += 1
      tokens.push({ kind: 'number', text: source.slice(at, i), at })
      continue
    }
    if (ch === '-' && source[i + 1] === '>') {
      tokens.push({ kind: 'punct', text: '->', at: i })
      i += 2
      continue
    }
    if (ch === '$') {
      tokens.push({ kind: 'dollar', at: i })
      i += 1
      continue
    }
    if (ch === '@') {
      tokens.push({ kind: 'slot', at: i })
      i += 1
      continue
    }
    if (isLetter(ch) || (ch === '_' && isNameChar(source[i + 1]))) {
      const at = i
      i += 1
      for (;;) {
        const c = source[i]
        if (c === '_' && !isNameChar(source[i + 1])) break
        if (!isNameChar(c)) break
        i += 1
      }
      tokens.push({ kind: 'name', text: source.slice(at, i), at })
      continue
    }
    if (ch === '"') {
      const at = i
      i += 1
      let text = ''
      while (i < source.length && source[i] !== '"') {
        if (source[i] === '\\') {
          const next = source[i + 1]
          if (next === 'n') text += '\n'
          else if (next === 't') text += '\t'
          else if (next === '"' || next === '\\') text += next
          else throw new ToolError(`character ${i + 1}: unknown escape "\\${String(next)}"`, ToolErrorCode.ParseSyntax)
          i += 2
          continue
        }
        text += source[i]
        i += 1
      }
      if (i >= source.length) throw new ToolError(`character ${at + 1}: unterminated string`, ToolErrorCode.ParseSyntax)
      i += 1
      tokens.push({ kind: 'string', text, at })
      continue
    }
    if (PUNCT.includes(ch)) {
      tokens.push({ kind: 'punct', text: ch, at: i })
      i += 1
      continue
    }
    const code = ch.codePointAt(0) ?? 0
    const shown = code > 126 || code < 32 ? `U+${code.toString(16).toUpperCase().padStart(4, '0')}` : `'${ch}'`
    throw new ToolError(
      `character ${i + 1}: ${shown} is not allowed — formulas are ASCII; use a notation such as $sum, or a value such as 4.7kohm`,
      ToolErrorCode.ParseSyntax,
    )
  }
  return tokens
}

/* ── evaluator ───────────────────────────────────────────────────────────── */

class Evaluator {
  private index = 0
  /** Binding variables in scope, innermost last. */
  private readonly bindings: Array<{ name: string; value: Evaluated }> = []

  constructor(
    private readonly tokens: Token[],
    private readonly source: string,
    private readonly context: EvalContext,
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.index]
  }

  private eat(): Token | undefined {
    const token = this.tokens[this.index]
    this.index += 1
    return token
  }

  private atEnd(): boolean {
    return this.index >= this.tokens.length
  }

  private fail(message: string, code: ToolErrorCode = ToolErrorCode.ParseSyntax, at?: number): never {
    const position = this.tokens[at ?? this.index]?.at ?? this.source.length
    throw new ToolError(`character ${position + 1}: ${message}`, code)
  }

  private accept(text: string): boolean {
    const token = this.peek()
    if (token !== undefined && token.kind === 'punct' && token.text === text) {
      this.index += 1
      return true
    }
    return false
  }

  private expect(text: string, what: string): void {
    if (!this.accept(text)) this.fail(`expected ${what} ('${text}')`)
  }

  /* grammar — see the language spec: additive → multiplicative → unary → power → postfix → primary */

  run(): TypedValue {
    if (this.tokens.length === 0) {
      throw new ToolError('the formula is empty — write one expression, referencing slots with @name', ToolErrorCode.ParseSyntax)
    }
    const value = this.expression()
    if (!this.atEnd()) {
      const token = this.tokens[this.index] as Token
      const shown = token.kind === 'punct' || token.kind === 'number' || token.kind === 'name' ? token.text : token.kind
      this.fail(`unexpected "${shown}" after the expression`)
    }
    return toStored(value)
  }

  private expression(): Evaluated {
    let left = this.multiplicative()
    for (;;) {
      const token = this.peek()
      if (token === undefined || token.kind !== 'punct' || (token.text !== '+' && token.text !== '-')) return left
      this.index += 1
      const right = this.multiplicative()
      left = elementwise(left, right, (x, y) => this.addScalar(x, y, token.text), token.text === '+' ? 'addition' : 'subtraction')
    }
  }

  private multiplicative(): Evaluated {
    let left = this.unary()
    for (;;) {
      const token = this.peek()
      if (token === undefined || token.kind !== 'punct' || (token.text !== '*' && token.text !== '/')) return left
      this.index += 1
      const right = this.unary()
      left = elementwise(left, right, (x, y) => (token.text === '*'
        ? this.multiplyScalar(x, y)
        : this.divideScalar(x, y)), token.text === '*' ? 'multiplication' : 'division')
    }
  }

  private unary(): Evaluated {
    if (this.accept('-')) return this.negate(this.unary())
    if (this.accept('+')) return this.unary()
    return this.power()
  }

  private negate(value: Evaluated): Evaluated {
    if (value.type === 'array') return { type: 'array', value: value.value.map((item) => this.negate(item)) }
    if (!isMeasured(value)) throw new ToolError(`cannot negate ${describe(value)}`, ToolErrorCode.TypeNotArithmetic)
    const p = parts(value)
    return measured(-p.re, -p.im, value.measure)
  }

  private power(): Evaluated {
    const base = this.postfix()
    if (!this.accept('^')) return base
    const exponent = this.unary()
    return elementwise(base, exponent, (x, y) => this.raiseScalar(x, y), 'exponentiation')
  }

  private postfix(): Evaluated {
    let value = this.primary()
    for (;;) {
      if (this.accept('[')) {
        const index = this.expression()
        this.expect(']', 'the closing bracket')
        value = this.indexInto(value, index)
        continue
      }
      if (this.accept('.')) {
        const token = this.eat()
        if (token === undefined || token.kind !== 'name') this.fail('expected a field name after "."')
        value = this.fieldOf(value, token.text)
        continue
      }
      return value
    }
  }

  private primary(): Evaluated {
    const token = this.eat()
    if (token === undefined) this.fail('the formula ends where a value was expected')

    if (token.kind === 'number') {
      // A unit written after a space belongs to the number: `100 ohm`.
      const next = this.peek()
      if (next !== undefined && next.kind === 'name' && (isUnit(next.text) || isPrefix(next.text))) {
        this.index += 1
        return fromStored(parseLiteral(token.text + next.text, token.at))
      }
      return fromStored(parseLiteral(token.text, token.at))
    }
    if (token.kind === 'string') return { type: 'string', value: token.text }
    if (token.kind === 'dollar') return this.symbol()
    if (token.kind === 'slot') {
      const name = this.eat()
      if (name === undefined || name.kind !== 'name') this.fail('expected a slot name after "@"')
      return this.slot(name.text, name.at)
    }
    if (token.kind === 'name') return this.binding(token.text, token.at)
    if (token.kind === 'punct' && token.text === '(') {
      const inner = this.expression()
      this.expect(')', 'the closing parenthesis')
      return inner
    }
    if (token.kind === 'punct' && token.text === '[') return this.arrayLiteral()
    if (token.kind === 'punct' && token.text === '{') return this.objectLiteral()
    // Only punctuation can reach this point: every other token kind returned above.
    this.fail(`"${token.text}" cannot start a value`)
  }

  /* notations */

  private symbol(): Evaluated {
    const nameToken = this.eat()
    if (nameToken === undefined || nameToken.kind !== 'name') this.fail('expected a notation name after "$"')
    const name = nameToken.text
    const info = SYMBOLS[name]
    if (info === undefined) {
      throw new ToolError(
        `character ${nameToken.at + 1}: "$${name}" is not a notation — ${symbolVocabulary()}`,
        ToolErrorCode.ParseSymbol,
      )
    }

    // The subscript and superscript positions; what goes in them belongs to the notation.
    let subscript: Position | undefined
    let superscript: Position | undefined
    if (this.accept('_')) {
      this.expect('{', 'the subscript position, written _{...}')
      subscript = this.positionExpression()
      this.expect('}', 'the end of the subscript')
    }
    if (this.accept('^')) {
      this.expect('{', 'the superscript position, written ^{...}')
      superscript = this.positionExpression()
      this.expect('}', 'the end of the superscript')
    }

    if (info.form === SymbolForm.Constant) {
      if (subscript !== undefined || superscript !== undefined) {
        this.fail(`"$${name}" is a constant and takes no subscript or superscript`)
      }
      return this.constant(name)
    }

    if (info.form === SymbolForm.Binder) {
      const written = info.writeAs ?? `$${name}_{...}^{...}(...)`
      if (subscript === undefined) {
        throw new ToolError(
          `character ${nameToken.at + 1}: "$${name}" needs its subscript position — write ${written}`,
          ToolErrorCode.ParseArity,
        )
      }
      if (!info.evaluable) {
        throw new ToolError(
          `character ${nameToken.at + 1}: "$${name}" is a notation this engine cannot evaluate — write ${written} out in closed form instead, or say the value cannot be computed`,
          ToolErrorCode.SymbolNotEvaluable,
        )
      }
      return this.binder(name, nameToken.at, subscript, superscript)
    }

    if (subscript !== undefined || superscript !== undefined) {
      this.fail(`"$${name}" is a function and takes no subscript or superscript — write ${info.writeAs ?? `$${name}(...)`}`)
    }
    if (!info.evaluable) {
      throw new ToolError(
        `character ${nameToken.at + 1}: "$${name}" is a notation this engine cannot evaluate — write ${info.writeAs ?? `$${name}(...)`} out in closed form instead, or say the value cannot be computed`,
        ToolErrorCode.SymbolNotEvaluable,
      )
    }
    if (!this.accept('(')) {
      throw new ToolError(
        `character ${nameToken.at + 1}: "$${name}" is a function and needs its arguments — write ${info.writeAs ?? `$${name}(...)`}`,
        ToolErrorCode.ParseSymbol,
      )
    }
    const args: Evaluated[] = []
    if (!this.accept(')')) {
      for (;;) {
        args.push(this.expression())
        if (this.accept(')')) break
        this.expect(',', 'a comma between arguments')
      }
    }
    return this.call(name, nameToken.at, args, info.arity)
  }

  /**
   * The contents of a `_{...}` or `^{...}` position. A position holds whatever
   * the notation defines — a binding variable with its lower bound (`k=a`), an
   * approaching variable (`x->a`), or a bound on its own (`0`) — so this reads
   * the shape rather than a single value.
   */
  private positionExpression(): Position {
    const token = this.peek()
    if (token === undefined) this.fail('the position is empty')
    if (token.kind === 'name') {
      const next = this.tokens[this.index + 1]
      if (next !== undefined && next.kind === 'punct' && (next.text === '=' || next.text === '->')) {
        this.index += 2
        const bound = this.expression()
        if (next.text === '->') return { kind: 'name', text: token.text }
        return { kind: 'bind', name: token.text, from: bound }
      }
      this.index += 1
      return { kind: 'name', text: token.text }
    }
    return { kind: 'value', value: this.expression() }
  }

  private constant(name: string): Evaluated {
    const none = measureOf(NONE)
    switch (name) {
      case 'pi': return { type: 'number', value: Math.PI, measure: none }
      case 'e': return { type: 'number', value: Math.E, measure: none }
      case 'inf': return { type: 'number', value: Number.POSITIVE_INFINITY, measure: none }
      default: return { type: 'complex', value: { re: 0, im: 1 }, measure: none }
    }
  }

  private slot(name: string, at: number): Evaluated {
    const value = this.context.readSlot(name)
    if (value === undefined) {
      throw new ToolError(
        `character ${at + 1}: slot "${name}" is not declared — only the conditions the user gave, or the target of an earlier eval, exist`,
        ToolErrorCode.SlotUndeclared,
      )
    }
    this.context.used.set(name, value)
    return fromStored(value)
  }

  private binding(name: string, at: number): Evaluated {
    for (let i = this.bindings.length - 1; i >= 0; i -= 1) {
      const entry = this.bindings[i] as { name: string; value: Evaluated }
      if (entry.name === name) return entry.value
    }
    throw new ToolError(
      `character ${at + 1}: "${name}" is not bound — a bare name must be introduced by $sum, $prod, $seq, $diff, $integral or $limit; to read a slot write "@${name}"`,
      ToolErrorCode.IdentUnbound,
    )
  }

  private arrayLiteral(): Evaluated {
    const items: Evaluated[] = []
    if (!this.accept(']')) {
      for (;;) {
        items.push(this.expression())
        if (this.accept(']')) break
        this.expect(',', 'a comma between elements')
      }
    }
    return this.homogeneousArray(items)
  }

  private objectLiteral(): Evaluated {
    const fields: Record<string, Evaluated> = {}
    if (!this.accept('}')) {
      for (;;) {
        const key = this.eat()
        if (key === undefined || key.kind !== 'name') this.fail('expected a field name')
        this.expect(':', 'a colon after the field name')
        fields[key.text] = this.expression()
        if (this.accept('}')) break
        this.expect(',', 'a comma between fields')
      }
    }
    return { type: 'object', value: fields }
  }

  /** An array holds one kind of value: that is what makes it a column of numbers. */
  private homogeneousArray(items: Evaluated[]): Evaluated {
    const first = items[0]
    if (first !== undefined) {
      for (let i = 1; i < items.length; i += 1) {
        const item = items[i] as Evaluated
        const same = isMeasured(first) && isMeasured(item)
          ? addableMeasure(first.measure, item.measure) === undefined
          : first.type === item.type
        if (!same) {
          throw new ToolError(
            `array elements must all be one kind: element ${i + 1} is ${describe(item)}, but element 1 is ${describe(first)}`,
            ToolErrorCode.TypeMixedKind,
          )
        }
      }
    }
    return { type: 'array', value: items }
  }

  /* arithmetic */

  private addScalar(a: Evaluated, b: Evaluated, operator: string): Evaluated {
    if (!isMeasured(a) || !isMeasured(b)) {
      throw new ToolError(`cannot ${operator === '+' ? 'add' : 'subtract'} ${describe(a)} and ${describe(b)}`, ToolErrorCode.TypeNotArithmetic)
    }
    const problem = addableMeasure(a.measure, b.measure)
    if (problem !== undefined) throw new ToolError(problem, ToolErrorCode.DimMismatch)
    const pa = parts(a)
    const pb = parts(b)
    const re = operator === '+' ? pa.re + pb.re : pa.re - pb.re
    const im = operator === '+' ? pa.im + pb.im : pa.im - pb.im
    return measured(re, im, { kind: a.measure.kind ?? b.measure.kind, dim: a.measure.dim })
  }

  private multiplyScalar(a: Evaluated, b: Evaluated): Evaluated {
    if (!isMeasured(a) || !isMeasured(b)) {
      throw new ToolError(`cannot multiply ${describe(a)} by ${describe(b)}`, ToolErrorCode.TypeNotArithmetic)
    }
    const pa = parts(a)
    const pb = parts(b)
    return measured(
      pa.re * pb.re - pa.im * pb.im,
      pa.re * pb.im + pa.im * pb.re,
      multiplyMeasure(a.measure, b.measure),
    )
  }

  private divideScalar(a: Evaluated, b: Evaluated): Evaluated {
    if (!isMeasured(a) || !isMeasured(b)) {
      throw new ToolError(`cannot divide ${describe(a)} by ${describe(b)}`, ToolErrorCode.TypeNotArithmetic)
    }
    const pb = parts(b)
    const denominator = pb.re * pb.re + pb.im * pb.im
    if (denominator === 0) throw new ToolError('division by zero', ToolErrorCode.RangeDomain)
    const pa = parts(a)
    return measured(
      (pa.re * pb.re + pa.im * pb.im) / denominator,
      (pa.im * pb.re - pa.re * pb.im) / denominator,
      divideMeasure(a.measure, b.measure),
    )
  }

  private raiseScalar(a: Evaluated, b: Evaluated): Evaluated {
    if (!isMeasured(a) || !isMeasured(b)) {
      throw new ToolError(`cannot raise ${describe(a)} to ${describe(b)}`, ToolErrorCode.TypeNotArithmetic)
    }
    const exponent = parts(b)
    if (b.measure.kind !== NONE || exponent.im !== 0) {
      throw new ToolError(
        `an exponent must be a plain count with no unit, got ${describe(b)} — the exponent is the number of times a value is multiplied by itself`,
        ToolErrorCode.DimMismatch,
      )
    }
    const pa = parts(a)
    const measure = powerMeasure(a.measure, exponent.re)
    if (pa.im === 0 && pa.re >= 0) return measured(pa.re ** exponent.re, 0, measure)
    const magnitude = Math.hypot(pa.re, pa.im) ** exponent.re
    const angle = Math.atan2(pa.im, pa.re) * exponent.re
    return measured(magnitude * Math.cos(angle), magnitude * Math.sin(angle), measure)
  }

  /* data access */

  private indexInto(value: Evaluated, index: Evaluated): Evaluated {
    if (value.type !== 'array') {
      throw new ToolError(`${describe(value)} cannot be indexed — only an array has elements`, ToolErrorCode.NotIndexable)
    }
    if (!isMeasured(index) || index.measure.kind !== NONE || !Number.isInteger(parts(index).re)) {
      throw new ToolError(`an index must be a whole number with no unit, got ${describe(index)}`, ToolErrorCode.RangeIndex)
    }
    const at = parts(index).re
    const item = value.value[at]
    if (item === undefined) {
      throw new ToolError(`index ${at} is out of range — the array has ${value.value.length} element(s)`, ToolErrorCode.RangeIndex)
    }
    return item
  }

  private fieldOf(value: Evaluated, field: string): Evaluated {
    if (value.type !== 'object') {
      throw new ToolError(`${describe(value)} has no fields — only an object does`, ToolErrorCode.NoField)
    }
    const found = value.value[field]
    if (found === undefined) {
      const available = Object.keys(value.value)
      throw new ToolError(`the object has no field "${field}" — it has: ${available.join(', ')}`, ToolErrorCode.NoField)
    }
    return found
  }

  /* notations that take a body */

  private call(name: string, at: number, args: Evaluated[], arity: readonly [number, number | null] | undefined): Evaluated {
    if (arity !== undefined) {
      const [min, max] = arity
      if (args.length < min || (max !== null && args.length > max)) {
        const wanted = max === null ? `at least ${min}` : min === max ? `${min}` : `${min} to ${max}`
        throw new ToolError(
          `character ${at + 1}: "$${name}" takes ${wanted} argument(s), got ${args.length}`,
          ToolErrorCode.ParseArity,
        )
      }
    }
    return applyFunction(name, args)
  }

  /**
   * A binding notation: `$sum_{k=a}^{b}(body)` and its siblings. The subscript
   * position gives the variable and its lower bound, the superscript the upper
   * bound. The body is re-read once per step with the variable bound, which is
   * why the end of the body is found before the loop starts.
   */
  private binder(name: string, at: number, subscript: Position, superscript: Position | undefined): Evaluated {
    const written = SYMBOLS[name]?.writeAs ?? `$${name}_{k=a}^{b}(body)`
    if (subscript.kind !== 'bind') {
      throw new ToolError(
        `character ${at + 1}: "$${name}" needs a binding variable and a lower bound — write ${written}`,
        ToolErrorCode.ParseArity,
      )
    }
    const variable = subscript.name
    const lower = this.integerOf(subscript.from, 'the lower bound')
    if (superscript === undefined) {
      throw new ToolError(`character ${at + 1}: "$${name}" needs an upper bound — write ${written}`, ToolErrorCode.ParseArity)
    }
    if (superscript.kind === 'name') {
      throw new ToolError(
        `character ${at + 1}: "${superscript.text}" is not a value — the upper bound is an expression such as ^{5} or ^{@n}`,
        ToolErrorCode.IdentUnbound,
      )
    }
    if (superscript.kind === 'bind') {
      throw new ToolError(`character ${at + 1}: the superscript position holds the upper bound — write ${written}`, ToolErrorCode.ParseArity)
    }
    const upper = this.integerOf(superscript.value, 'the upper bound')
    if (upper < lower) {
      throw new ToolError(`the upper bound ${upper} is below the lower bound ${lower} — nothing to ${name}`, ToolErrorCode.RangeIndex)
    }

    this.expect('(', `the body of "$${name}"`)
    const bodyStart = this.index
    const bodyEnd = this.findMatchingParen(bodyStart)

    const items: Evaluated[] = []
    let total: Evaluated | undefined
    for (let value = lower; value <= upper; value += 1) {
      this.index = bodyStart
      this.bindings.push({ name: variable, value: { type: 'number', value, measure: measureOf(NONE) } })
      const step = this.expression()
      this.bindings.pop()
      if (this.index !== bodyEnd) this.fail(`unexpected content in the body of "$${name}"`)
      items.push(step)
      if (name === 'sum') total = total === undefined ? step : this.addScalar(total, step, '+')
      if (name === 'prod') total = total === undefined ? step : this.multiplyScalar(total, step)
    }
    this.index = bodyEnd + 1

    if (name === 'seq') return this.homogeneousArray(items)
    return total ?? { type: 'number', value: name === 'prod' ? 1 : 0, measure: measureOf(NONE) }
  }

  /** The index of the `)` matching the `(` just consumed. */
  private findMatchingParen(from: number): number {
    let depth = 0
    for (let i = from; i < this.tokens.length; i += 1) {
      const token = this.tokens[i] as Token
      if (token.kind !== 'punct') continue
      if (token.text === '(' || token.text === '[' || token.text === '{') depth += 1
      else if (token.text === ')' || token.text === ']' || token.text === '}') {
        if (depth === 0) return i
        depth -= 1
      }
    }
    this.fail('the body is missing its closing parenthesis')
  }

  private integerOf(value: Evaluated, what: string): number {
    if (!isMeasured(value) || value.measure.kind !== NONE || !Number.isInteger(parts(value).re)) {
      throw new ToolError(`${what} must be a whole number with no unit, got ${describe(value)}`, ToolErrorCode.RangeIndex)
    }
    return parts(value).re
  }
}

/* ── functions ───────────────────────────────────────────────────────────── */

/** A number or complex argument, with the message a refusal needs. */
function complexOf(value: Evaluated, name: string): Measured {
  if (!isMeasured(value)) {
    throw new ToolError(`$${name} takes a number, got ${describe(value)}`, ToolErrorCode.TypeNotArithmetic)
  }
  return value
}

/** A real argument of any measure. */
function numberOf(value: Evaluated, name: string, what: string): number {
  const measured = complexOf(value, name)
  const p = parts(measured)
  if (p.im !== 0) throw new ToolError(`$${name} takes ${what}, got a complex number`, ToolErrorCode.TypeNotArithmetic)
  return p.re
}

/** A real argument that must be dimensionless: what the transcendental functions need. */
function dimensionlessOf(value: Evaluated, name: string, what: string): number {
  const measured = complexOf(value, name)
  if (!isDimensionless(measured.measure.dim)) {
    throw new ToolError(`$${name} takes ${what}, got ${describeMeasure(measured.measure)}`, ToolErrorCode.DimMismatch)
  }
  return numberOf(measured, name, what)
}

function applyFunction(name: string, args: Evaluated[]): Evaluated {
  const first = args[0] as Evaluated
  switch (name) {
    case 'abs': {
      const z = complexOf(first, name)
      const p = parts(z)
      return measured(Math.hypot(p.re, p.im), 0, z.measure)
    }
    case 're': {
      const z = complexOf(first, name)
      return measured(parts(z).re, 0, z.measure)
    }
    case 'im': {
      const z = complexOf(first, name)
      return measured(parts(z).im, 0, z.measure)
    }
    case 'conj': {
      const z = complexOf(first, name)
      const p = parts(z)
      return measured(p.re, -p.im, z.measure)
    }
    case 'arg': {
      const p = parts(complexOf(first, name))
      return measured(Math.atan2(p.im, p.re), 0, measureOf(QuantityKind.Angle))
    }
    case 'sqrt': {
      const z = complexOf(first, name)
      const p = parts(z)
      const magnitude = Math.sqrt(Math.hypot(p.re, p.im))
      const angle = Math.atan2(p.im, p.re) / 2
      return measured(magnitude * Math.cos(angle), magnitude * Math.sin(angle), powerMeasure(z.measure, 0.5))
    }
    case 'transpose': {
      if (first.type !== 'array' || !first.value.every((row) => row.type === 'array')) {
        throw new ToolError('$transpose takes a matrix written as arrays of arrays', ToolErrorCode.ArgsInvalid)
      }
      const rows = first.value as Array<Extract<Evaluated, { type: 'array' }>>
      const width = (rows[0] as Extract<Evaluated, { type: 'array' }>).value.length
      if (!rows.every((row) => row.value.length === width)) {
        throw new ToolError('$transpose needs rows of equal length', ToolErrorCode.ArgsInvalid)
      }
      const out: Evaluated[] = []
      for (let column = 0; column < width; column += 1) {
        out.push({ type: 'array', value: rows.map((row) => row.value[column] as Evaluated) })
      }
      return { type: 'array', value: out }
    }
  }

  // Trigonometric functions take an angle or a plain count; an angle is already
  // stored in radians, so one call serves both spellings.
  if (name === 'sin' || name === 'cos' || name === 'tan') {
    const x = dimensionlessOf(first, name, 'an angle or a plain count')
    const measure = measureOf(NONE)
    if (name === 'sin') return measured(Math.sin(x), 0, measure)
    if (name === 'cos') return measured(Math.cos(x), 0, measure)
    return measured(Math.tan(x), 0, measure)
  }

  if (name === 'asin' || name === 'acos' || name === 'atan') {
    const x = dimensionlessOf(first, name, 'a plain count between -1 and 1')
    if (x < -1 || x > 1) throw new ToolError(`$${name} is defined between -1 and 1, got ${x}`, ToolErrorCode.RangeDomain)
    const measure = measureOf(QuantityKind.Angle)
    if (name === 'asin') return measured(Math.asin(x), 0, measure)
    if (name === 'acos') return measured(Math.acos(x), 0, measure)
    return measured(Math.atan(x), 0, measure)
  }

  if (name === 'atan2') {
    const y = dimensionlessOf(args[0] as Evaluated, name, 'a plain count')
    const x = dimensionlessOf(args[1] as Evaluated, name, 'a plain count')
    return measured(Math.atan2(y, x), 0, measureOf(QuantityKind.Angle))
  }

  if (name === 'exp' || name === 'ln' || name === 'log' || name === 'floor' || name === 'ceil' || name === 'sign') {
    const x = dimensionlessOf(first, name, 'a plain count')
    const measure = measureOf(NONE)
    switch (name) {
      case 'exp': return measured(Math.exp(x), 0, measure)
      case 'ln':
        if (x <= 0) throw new ToolError('$ln is defined for positive numbers only', ToolErrorCode.RangeDomain)
        return measured(Math.log(x), 0, measure)
      case 'log':
        if (x <= 0) throw new ToolError('$log is defined for positive numbers only', ToolErrorCode.RangeDomain)
        return measured(Math.log10(x), 0, measure)
      case 'sign': return measured(Math.sign(x), 0, measure)
      case 'floor': return measured(Math.floor(x), 0, measure)
      default: return measured(Math.ceil(x), 0, measure)
    }
  }

  // The two-argument pair functions need both sides to measure the same thing,
  // so the refusal is the same one addition gives.
  if (name === 'min' || name === 'max' || name === 'mod') {
    const a = complexOf(args[0] as Evaluated, name)
    const b = complexOf(args[1] as Evaluated, name)
    const problem = addableMeasure(a.measure, b.measure, name === 'mod' ? 'take the remainder of' : 'compare')
    if (problem !== undefined) throw new ToolError(problem, ToolErrorCode.DimMismatch)
    const x = numberOf(a, name, 'a real number')
    const y = numberOf(b, name, 'a real number')
    if (name === 'min') return measured(Math.min(x, y), 0, a.measure)
    if (name === 'max') return measured(Math.max(x, y), 0, a.measure)
    if (y === 0) throw new ToolError('$mod by zero', ToolErrorCode.RangeDomain)
    return measured(x % y, 0, a.measure)
  }

  throw new ToolError(`$${name} is not implemented`, ToolErrorCode.ParseSymbol)
}

/* ── entry ───────────────────────────────────────────────────────────────── */

/** Evaluate one formula against a context. Throws a ToolError; never returns a partial value. */
export function evaluateFormula(source: string, context: EvalContext): TypedValue {
  return new Evaluator(tokenize(source), source, context).run()
}
