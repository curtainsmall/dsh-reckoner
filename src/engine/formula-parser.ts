/**
 * The formula grammar: one expression, recursive descent, exactly the
 * precedence the language documents (additive, multiplicative, unary, power,
 * postfix, primary). Shapes are checked here; dimensions are checked while
 * evaluating.
 */
import { fail } from '../errors.ts'
import { notationLookup, notationVocabulary, type NotationEntry } from './notation.ts'
import { formulaPosition, tokenLabel, tokenize, type ScalarLiteral, type Token } from './formula-lexer.ts'

export interface ScalarExpression {
  readonly kind: 'scalar'
  readonly scalar: ScalarLiteral
  readonly at: number
}

/** A bare name: only a bound variable can be read this way. */
export interface BindingExpression {
  readonly kind: 'binding'
  readonly name: string
  readonly at: number
}

export interface SlotExpression {
  readonly kind: 'slot'
  readonly name: string
  readonly at: number
}

export type AccessMember = { readonly kind: 'index'; readonly index: Expression } | { readonly kind: 'field'; readonly name: string }

export interface AccessExpression {
  readonly kind: 'access'
  readonly base: Expression
  readonly member: AccessMember
  readonly at: number
}

/** A bound variable and the expression it is bound to: `_{k=a}` or `_{x->a}`. */
export interface Binder {
  readonly variable: string
  readonly from: Expression
  readonly arrow: boolean
}

export interface CallExpression {
  readonly kind: 'call'
  readonly symbol: string
  readonly args: readonly Expression[]
  readonly at: number
  /** The subscript's bound variable (`$sum_{k=a}`, `$limit_{x->a}`). */
  readonly binder?: Binder
  /** The upper bound of `^{b}`. */
  readonly until?: Expression
  /** `$integral_{a}^{b}`: the lower bound is a plain expression, the variable comes from the second argument. */
  readonly from?: Expression
}

export interface UnaryExpression {
  readonly kind: 'unary'
  readonly operator: '+' | '-'
  readonly operand: Expression
  readonly at: number
}

export interface BinaryExpression {
  readonly kind: 'binary'
  readonly operator: '+' | '-' | '*' | '/' | '^'
  readonly left: Expression
  readonly right: Expression
  readonly at: number
}

export type Expression =
  | ScalarExpression
  | BindingExpression
  | SlotExpression
  | AccessExpression
  | CallExpression
  | UnaryExpression
  | BinaryExpression

class Parser {
  private index = 0

  constructor(private readonly formula: string, private readonly tokens: readonly Token[]) {}

  parseFormula(): Expression {
    const expression = this.parseAdditive()
    const token = this.peek()
    if (token.kind !== 'eof') {
      fail(
        'ENGINE_INVALID_FORMULA',
        `${formulaPosition(this.formula, token.at)}: ${tokenLabel(token)} follows a complete expression, but a formula is ONE expression. Join the parts with an operator, or evaluate one step per call.`,
      )
    }
    return expression
  }

  private peek(): Token {
    return this.tokens[this.index] ?? { kind: 'eof', text: '', at: this.formula.length }
  }

  private next(): Token {
    const token = this.peek()
    if (token.kind !== 'eof') this.index += 1
    return token
  }

  private isPunct(text: string): boolean {
    const token = this.peek()
    return token.kind === 'punct' && token.text === text
  }

  private expectPunct(text: string, hint: string): void {
    const token = this.peek()
    if (token.kind === 'punct' && token.text === text) {
      this.next()
      return
    }
    fail('ENGINE_INVALID_FORMULA', `${formulaPosition(this.formula, token.at)}: expected "${text}"; found ${tokenLabel(token)}. ${hint}`)
  }

  private parseAdditive(): Expression {
    let left = this.parseMultiplicative()
    for (;;) {
      const token = this.peek()
      if (token.kind !== 'punct' || (token.text !== '+' && token.text !== '-')) return left
      this.next()
      const right = this.parseMultiplicative()
      left = { kind: 'binary', operator: token.text, left, right, at: token.at }
    }
  }

  private parseMultiplicative(): Expression {
    let left = this.parseUnary()
    for (;;) {
      const token = this.peek()
      if (token.kind !== 'punct' || (token.text !== '*' && token.text !== '/')) return left
      this.next()
      const right = this.parseUnary()
      left = { kind: 'binary', operator: token.text, left, right, at: token.at }
    }
  }

  private parseUnary(): Expression {
    const token = this.peek()
    if (token.kind === 'punct' && (token.text === '-' || token.text === '+')) {
      this.next()
      const operand = this.parseUnary()
      return token.text === '-' ? { kind: 'unary', operator: '-', operand, at: token.at } : operand
    }
    return this.parsePower()
  }

  private parsePower(): Expression {
    const base = this.parsePostfix()
    const token = this.peek()
    if (token.kind !== 'punct' || token.text !== '^') return base
    this.next()
    const after = this.peek()
    if (after.kind === 'punct' && after.text === '{') {
      fail(
        'ENGINE_INVALID_FORMULA',
        `${formulaPosition(this.formula, after.at)}: "{" cannot follow "^". A position is written directly after its notation name, as in $sum_{k=a}^{b}(body); for a power write $e^(2) or $pi^2.`,
      )
    }
    const exponent = this.parseUnary()
    return { kind: 'binary', operator: '^', left: base, right: exponent, at: token.at }
  }

  private parsePostfix(): Expression {
    let base = this.parsePrimary()
    for (;;) {
      const token = this.peek()
      if (token.kind === 'punct' && token.text === '[') {
        this.next()
        const index = this.parseAdditive()
        this.expectPunct(']', `The "[" at character ${token.at + 1} is never closed.`)
        base = { kind: 'access', base, member: { kind: 'index', index }, at: token.at }
        continue
      }
      if (token.kind === 'punct' && token.text === '.') {
        this.next()
        const name = this.peek()
        if (name.kind !== 'name') {
          fail(
            'ENGINE_INVALID_FORMULA',
            `${formulaPosition(this.formula, name.at)}: "." takes an object field name after it, as in @th.field; found ${tokenLabel(name)}.`,
          )
        }
        this.next()
        base = { kind: 'access', base, member: { kind: 'field', name: name.text }, at: token.at }
        continue
      }
      return base
    }
  }

  private parsePrimary(): Expression {
    const token = this.peek()
    if (token.kind === 'number') {
      this.next()
      const scalar = token.scalar
      if (scalar === undefined) fail('ENGINE_UNKNOWN_ERROR', `internal: the number token "${token.text}" carries no value.`)
      return { kind: 'scalar', scalar, at: token.at }
    }
    if (token.kind === 'slot') {
      this.next()
      return { kind: 'slot', name: token.text.slice(1), at: token.at }
    }
    if (token.kind === 'symbol') return this.parseSymbol()
    if (token.kind === 'name') {
      this.next()
      return { kind: 'binding', name: token.text, at: token.at }
    }
    if (token.kind === 'punct' && token.text === '(') {
      this.next()
      const inner = this.parseAdditive()
      this.expectPunct(')', `The "(" at character ${token.at + 1} is never closed.`)
      return inner
    }
    fail(
      'ENGINE_INVALID_FORMULA',
      `${formulaPosition(this.formula, token.at)}: expected a number, a slot (@name), a notation ($name), a bound variable name or "("; found ${tokenLabel(token)}.`,
    )
  }

  private parseSymbol(): Expression {
    const token = this.next()
    const entry = notationLookup(token.text)
    if (entry === undefined) {
      fail(
        'ENGINE_INVALID_NOTATION',
        `${formulaPosition(this.formula, token.at)}: "${token.text}" is not in the notation table. The notation is: ${notationVocabulary()}.`,
      )
    }
    if (entry.notationClass === 'constant') {
      const after = this.peek()
      if (after.kind === 'punct' && (after.text === '(' || after.text === '_')) {
        fail(
          'ENGINE_INVALID_NOTATION',
          `${formulaPosition(this.formula, after.at)}: "${token.text}" is a constant and takes no arguments or position. Write it bare, and use "^" for a power such as ${token.text}^2.`,
        )
      }
      return { kind: 'call', symbol: token.text, args: [], at: token.at }
    }
    if (entry.notationClass === 'function') {
      if (this.isPunct('_')) {
        fail(
          'ENGINE_INVALID_NOTATION',
          `${formulaPosition(this.formula, this.peek().at)}: "${token.text}" takes its arguments in parentheses, not a subscript. Write ${entry.form}.`,
        )
      }
      if (!this.isPunct('(')) {
        fail(
          'ENGINE_INVALID_NOTATION',
          `${formulaPosition(this.formula, this.peek().at)}: "${token.text}" needs its arguments in parentheses. Write ${entry.form}.`,
        )
      }
      const args = this.parseArguments(entry)
      this.requireArity(entry, args.length, token)
      return { kind: 'call', symbol: token.text, args, at: token.at }
    }
    return this.parseBindingSymbol(entry, token)
  }

  private parseBindingSymbol(entry: NotationEntry, token: Token): CallExpression {
    if (entry.symbol === '$diff') {
      if (!this.isPunct('(')) {
        fail(
          'ENGINE_INVALID_NOTATION',
          `${formulaPosition(this.formula, this.peek().at)}: "$diff" is written ${entry.form}.`,
        )
      }
      const args = this.parseArguments(entry)
      this.requireArity(entry, args.length, token)
      this.requireVariableArgument(args[1], entry, token)
      return { kind: 'call', symbol: entry.symbol, args, at: token.at }
    }

    if (!this.isPunct('_')) {
      // $integral is the one binding symbol whose bounds may be left out: $integral(body, x).
      if (entry.symbol === '$integral') {
        const args = this.parseArguments(entry)
        this.requireArity(entry, args.length, token)
        this.requireVariableArgument(args[1], entry, token)
        return { kind: 'call', symbol: entry.symbol, args, at: token.at }
      }
      fail(
        'ENGINE_INVALID_ARITY',
        `${formulaPosition(this.formula, this.peek().at)}: "${entry.symbol}" needs its bounds. Write ${entry.form}.`,
      )
    }
    this.next()
    const open = this.peek()
    this.expectPunct('{', 'A subscript is written _{...}, as in $sum_{k=a}^{b}(body).')
    const content = this.parseSubscriptContent()
    this.expectPunct('}', `The "{" at character ${open.at + 1} is never closed.`)

    if (entry.symbol === '$integral') {
      if (content.kind === 'binder') {
        fail(
          'ENGINE_INVALID_ARITY',
          `${formulaPosition(this.formula, token.at)}: "$integral" takes its bounds as plain expressions, not a bound variable. Write ${entry.form}.`,
        )
      }
      const until = this.parseUpperBound(entry)
      const args = this.parseArguments(entry)
      this.requireArity(entry, args.length, token)
      this.requireVariableArgument(args[1], entry, token)
      return { kind: 'call', symbol: entry.symbol, args, at: token.at, from: content.expression, until }
    }

    if (content.kind !== 'binder') {
      fail(
        'ENGINE_INVALID_ARITY',
        `${formulaPosition(this.formula, token.at)}: "${entry.symbol}" needs a bound variable in its subscript. Write ${entry.form}.`,
      )
    }
    if (entry.symbol === '$limit') {
      if (!content.binder.arrow) {
        fail(
          'ENGINE_INVALID_ARITY',
          `${formulaPosition(this.formula, token.at)}: "$limit" binds its variable with "->". Write ${entry.form}.`,
        )
      }
      const args = this.parseArguments(entry)
      this.requireArity(entry, args.length, token)
      return { kind: 'call', symbol: entry.symbol, args, at: token.at, binder: content.binder }
    }
    const until = this.parseUpperBound(entry)
    const args = this.parseArguments(entry)
    this.requireArity(entry, args.length, token)
    return { kind: 'call', symbol: entry.symbol, args, at: token.at, binder: content.binder, until }
  }

  private parseUpperBound(entry: NotationEntry): Expression {
    const token = this.peek()
    if (token.kind !== 'punct' || token.text !== '^') {
      fail(
        'ENGINE_INVALID_ARITY',
        `${formulaPosition(this.formula, token.at)}: "${entry.symbol}" needs its upper bound. Write ${entry.form}.`,
      )
    }
    this.next()
    const open = this.peek()
    this.expectPunct('{', 'The upper bound is written ^{...}, as in $sum_{k=a}^{b}(body).')
    const bound = this.parseAdditive()
    this.expectPunct('}', `The "{" at character ${open.at + 1} is never closed.`)
    return bound
  }

  /**
   * The subscript is either a bound variable (`k=a`, `x->a`) or, for
   * `$integral`, a plain lower bound. Both start with a name, so the
   * variable form is tried first and the fork point is restored if the name
   * is not followed by `=` or `->`.
   */
  private parseSubscriptContent(): { kind: 'binder'; binder: Binder } | { kind: 'expression'; expression: Expression } {
    const fork = this.index
    const first = this.peek()
    const second = this.tokens[this.index + 1]
    if (first.kind === 'name' && second !== undefined && second.kind === 'punct' && (second.text === '=' || second.text === '->')) {
      this.next()
      this.next()
      const from = this.parseAdditive()
      return { kind: 'binder', binder: { variable: first.text, from, arrow: second.text === '->' } }
    }
    this.index = fork
    return { kind: 'expression', expression: this.parseAdditive() }
  }

  private parseArguments(entry: NotationEntry): Expression[] {
    this.expectPunct('(', `"${entry.symbol}" takes its arguments in parentheses: ${entry.form}.`)
    const args: Expression[] = []
    if (this.isPunct(')')) {
      this.next()
      return args
    }
    for (;;) {
      args.push(this.parseAdditive())
      const token = this.peek()
      if (token.kind === 'punct' && token.text === ',') {
        this.next()
        continue
      }
      if (token.kind === 'punct' && token.text === ')') {
        this.next()
        return args
      }
      fail(
        'ENGINE_INVALID_FORMULA',
        `${formulaPosition(this.formula, token.at)}: expected "," or ")" in the argument list of "${entry.symbol}"; found ${tokenLabel(token)}.`,
      )
    }
  }

  private requireArity(entry: NotationEntry, count: number, token: Token): void {
    if (entry.arities.includes(count)) return
    fail(
      'ENGINE_INVALID_ARITY',
      `${formulaPosition(this.formula, token.at)}: "${entry.symbol}" takes ${entry.arities.join(' or ')} argument(s); got ${count}. Write ${entry.form}.`,
    )
  }

  private requireVariableArgument(argument: Expression | undefined, entry: NotationEntry, token: Token): void {
    if (argument !== undefined && argument.kind === 'binding') return
    fail(
      'ENGINE_INVALID_FORMULA',
      `${formulaPosition(this.formula, argument?.at ?? token.at)}: the second argument of "${entry.symbol}" names the variable the body is taken over; write a plain name, as in ${entry.form}.`,
    )
  }
}

/** Parse one formula. Returns the expression tree; throws an EngineError otherwise. */
export function parseFormula(formula: string): Expression {
  return new Parser(formula, tokenize(formula)).parseFormula()
}
