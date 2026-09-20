/**
 * The value parser: one string in, one canonical value out.
 *
 * The grammar is deliberately tiny. A slot's value is either a quantity, a
 * complex literal, an array, an object or a string — never an arithmetic
 * expression (that is what `eval` is for). So `1+2` is accepted only as the
 * complex literal 1+2i, and `2*3` is a syntax error.
 *
 *   value    := complex | array | object | string
 *   complex  := term (('+' | '-') term)*        # each term may be imaginary
 *   term     := NUMBER unit? | '(' value ')' unit?
 *   unit     := PREFIX? UNIT | UNIT              # PREFIX is one letter
 *
 * Parsing converts to the SI base and keeps the kind; the prefix and the unit
 * word are gone by the time a value exists. This is why `4.7kohm`, `4700ohm`
 * and `0.0047Mohm` are the same stored value.
 */
import { ToolError, ToolErrorCode } from '../errors.ts'
import { QuantityKind } from '../math/quantity-kind.ts'
import { PREFIX_SCALES, UNITS, isPrefix, isUnit, splitUnitWord } from './units.ts'
import type { TypedValue } from './values.ts'

/* ── tokenizer ───────────────────────────────────────────────────────────── */

type Token =
  | { kind: 'number'; text: string; at: number }
  | { kind: 'word'; text: string; at: number }
  | { kind: 'string'; text: string; at: number }
  | { kind: 'punct'; text: string; at: number }

const PUNCT = ['{', '}', '[', ']', '(', ')', ',', ':', '+', '-']

function describeChar(ch: string): string {
  const code = ch.codePointAt(0) ?? 0
  return code > 126 || code < 32 ? `U+${code.toString(16).toUpperCase().padStart(4, '0')}` : `'${ch}'`
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < source.length) {
    const ch = source[i] as string
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1
      continue
    }
    // number: digits, optional fraction, optional exponent (lowercase e only)
    if (ch >= '0' && ch <= '9' || (ch === '.' && i + 1 < source.length && source[i + 1]! >= '0' && source[i + 1]! <= '9')) {
      const at = i
      while (i < source.length && source[i]! >= '0' && source[i]! <= '9') i += 1
      if (source[i] === '.') {
        i += 1
        while (i < source.length && source[i]! >= '0' && source[i]! <= '9') i += 1
      }
      if (source[i] === 'e' || source[i] === 'E') {
        if (source[i] === 'E') {
          throw new ToolError(
            `character ${i + 1}: scientific notation takes a lowercase 'e', write "${source.slice(at, i)}e${source.slice(i + 1)}"`,
            ToolErrorCode.ParseNumber,
          )
        }
        const save = i
        i += 1
        if (source[i] === '+' || source[i] === '-') i += 1
        if (i < source.length && source[i]! >= '0' && source[i]! <= '9') {
          while (i < source.length && source[i]! >= '0' && source[i]! <= '9') i += 1
        } else {
          i = save
          throw new ToolError(
            `character ${save + 1}: 'e' must be followed by digits (as in 1e5); to multiply by e write "*" — for example "2*e"`,
            ToolErrorCode.ParseNumber,
          )
        }
      }
      tokens.push({ kind: 'number', text: source.slice(at, i), at })
      continue
    }
    // identifier: a word, or an imaginary suffix attached to nothing (j, i)
    if (ch === '_' || (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z')) {
      const at = i
      while (i < source.length && (source[i] === '_' || (source[i]! >= 'A' && source[i]! <= 'Z') || (source[i]! >= 'a' && source[i]! <= 'z') || (source[i]! >= '0' && source[i]! <= '9'))) i += 1
      tokens.push({ kind: 'word', text: source.slice(at, i), at })
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
      if (i >= source.length) throw new ToolError(`character ${at + 1}: unterminated string (a closing '"' is missing)`, ToolErrorCode.ParseSyntax)
      i += 1
      tokens.push({ kind: 'string', text, at })
      continue
    }
    if (PUNCT.includes(ch)) {
      tokens.push({ kind: 'punct', text: ch, at: i })
      i += 1
      continue
    }
    // 'i' and 'j' are words, so a bare imaginary unit token is handled above.
    throw new ToolError(
      `character ${i + 1}: ${describeChar(ch)} is not allowed — values are ASCII and a value is never an arithmetic expression`,
      ToolErrorCode.ParseSyntax,
    )
  }
  return tokens
}

/* ── parser ──────────────────────────────────────────────────────────────── */

/** A term under construction: its numeric parts, its kind, and whether it was imaginary. */
interface Term {
  re: number
  im: number
  kind: QuantityKind
  imaginary: boolean
}

class Parser {
  private index = 0

  constructor(private readonly tokens: Token[], private readonly source: string) {}

  private peek(): Token | undefined {
    return this.tokens[this.index]
  }

  private next(): Token | undefined {
    const token = this.tokens[this.index]
    this.index += 1
    return token
  }

  private expectPunct(text: string): Token {
    const token = this.next()
    if (token === undefined || token.kind !== 'punct' || token.text !== text) {
      throw new ToolError(
        `character ${(token?.at ?? this.source.length) + 1}: expected '${text}'`,
        ToolErrorCode.ParseSyntax,
      )
    }
    return token
  }

  private acceptPunct(text: string): boolean {
    const token = this.peek()
    if (token !== undefined && token.kind === 'punct' && token.text === text) {
      this.index += 1
      return true
    }
    return false
  }

  /** Parse the whole source as one value; trailing tokens are an error. */
  parseValue(): TypedValue {
    const value = this.parseComplex()
    const rest = this.peek()
    if (rest !== undefined) {
      throw new ToolError(
        `character ${rest.at + 1}: unexpected "${rest.text}" — a value is one quantity, complex number, array, object or string`,
        ToolErrorCode.ParseSyntax,
      )
    }
    return value
  }

  /**
   * A complex literal: terms joined by + and -, where a term may be imaginary.
   * A single real term gives a plain number; anything with an imaginary part
   * gives a complex.
   */
  private parseComplex(): TypedValue {
    const first = this.parseTerm()
    let re = first.re
    let im = first.im
    let kind: QuantityKind = first.kind
    let sawImaginary = first.imaginary
    let negative = false

    for (;;) {
      const token = this.peek()
      if (token === undefined || token.kind !== 'punct' || (token.text !== '+' && token.text !== '-')) break
      this.index += 1
      negative = token.text === '-'
      const term = this.parseTerm()
      if (term.kind !== kind && term.kind !== QuantityKind.None) {
        if (kind === QuantityKind.None) kind = term.kind
        else {
          throw new ToolError(
            `character ${token.at + 1}: the terms of a complex literal must be the same kind (${kind} and ${term.kind})`,
            ToolErrorCode.ParseUnit,
          )
        }
      } else if (term.kind !== QuantityKind.None) {
        kind = term.kind
      }
      const sign = negative ? -1 : 1
      re += sign * term.re
      im += sign * term.im
      if (term.imaginary) sawImaginary = true
    }

    if (first.kind === QuantityKind.None && kind === QuantityKind.None && !sawImaginary) {
      return { type: 'number', value: re, kind: QuantityKind.None }
    }
    if (im === 0 && !sawImaginary) return { type: 'number', value: re, kind }
    return { type: 'complex', value: { re, im }, kind }
  }

  /**
   * One term: a number (optionally with a prefix + unit + optional imaginary
   * suffix) or a parenthesised value (optionally with a unit).
   */
  private parseTerm(): Term {
    const token = this.next()
    if (token === undefined) {
      throw new ToolError(
        `character ${this.source.length + 1}: the value ends where a number was expected`,
        ToolErrorCode.ParseSyntax,
      )
    }

    if (token.kind === 'punct' && token.text === '(') {
      const inner = this.parseComplex()
      this.expectPunct(')')
      return this.applyUnit(this.asTerm(inner))
    }

    if (token.kind === 'word') {
      // A bare imaginary unit: `j`, `i` — `2j` is handled by the suffix below.
      if (token.text === 'i' || token.text === 'j') {
        return { re: 0, im: 1, kind: QuantityKind.None, imaginary: true }
      }
      throw new ToolError(
        `character ${token.at + 1}: "${token.text}" is not a value — a bare word has no meaning here; write a number, or a prefix+unit (4.7kohm)`,
        ToolErrorCode.ParseUnit,
      )
    }

    if (token.kind !== 'number') {
      throw new ToolError(`character ${token.at + 1}: expected a number, got "${token.text}"`, ToolErrorCode.ParseSyntax)
    }

    const digits = Number(token.text)
    if (!Number.isFinite(digits)) {
      throw new ToolError(`character ${token.at + 1}: "${token.text}" is not a finite number`, ToolErrorCode.ParseNumber)
    }

    // An imaginary suffix binds to the number: `2j`, `4i`.
    const suffix = this.peek()
    if (suffix !== undefined && suffix.kind === 'word' && (suffix.text === 'i' || suffix.text === 'j')) {
      this.index += 1
      return { re: 0, im: digits, kind: QuantityKind.None, imaginary: true }
    }

    if (this.peek()?.kind === 'word') {
      return this.applyUnit({ re: digits, im: 0, kind: QuantityKind.None, imaginary: false })
    }
    return { re: digits, im: 0, kind: QuantityKind.None, imaginary: false }
  }

  /**
   * Split a unit token into a prefix and a unit word. The tokenizer reads `kohm`
   * as one word (letters run together), so the split is `splitUnitWord`'s.
   */
  private splitUnit(token: Token & { kind: 'word' }): { scale: number; word: string } | undefined {
    const split = splitUnitWord(token.text)
    return split === undefined ? undefined : { scale: split.scale, word: split.unit }
  }

  /**
   * Apply an optional prefix + unit to a number.
   * `4.7kohm` = 4.7 × 1000 → 4700 ohm; `25degC` = 25 × 1 + 273.15 → 298.15 K.
   */
  private applyUnit(base: Term): Term {
    const first = this.peek()
    if (first === undefined || first.kind !== 'word') return base

    const split = this.splitUnit(first)
    if (split === undefined) {
      // A single letter after a number is the `1R` mistake: a name, not a unit.
      const bare = /^[A-Za-z]$/.test(first.text)
      const hint = isPrefix(first.text)
        ? `'${first.text}' is a prefix and must be followed by a unit (p n u m k M G T); to write 5 metres use "5metre"`
        : bare
          ? `"${first.text}" is not a unit word — an identifier cannot follow a number directly; to multiply, write "*" (as in "1*${first.text}")`
          : `"${first.text}" is not a unit word — units are whole words (ohm volt amp watt hertz second farad henry kelvin metre gram pascal joule radian decibel, degC degF deg bar psi atm cal Wh hp inch foot yard mile lb oz)`
      throw new ToolError(
        `character ${first.at + 1}: ${hint}`,
        isPrefix(first.text) || !bare ? ToolErrorCode.ParseUnit : ToolErrorCode.ParseIdent,
      )
    }

    const info = UNITS[split.word] as { kind: QuantityKind; factor: number; offset: number }
    this.index += 1

    const scaled = base.re * split.scale * info.factor + info.offset
    return { re: scaled, im: base.im, kind: info.kind, imaginary: false }
  }

  /** The parsed value of a parenthesised group, viewed as a term. */
  private asTerm(value: TypedValue): Term {
    if (value.type === 'number') return { re: value.value, im: 0, kind: value.kind, imaginary: false }
    if (value.type === 'complex') return { re: value.value.re, im: value.value.im, kind: value.kind, imaginary: value.value.im !== 0 }
    throw new ToolError(
      `a ${value.type} cannot carry a unit — apply the unit to a number`,
      ToolErrorCode.ParseUnit,
    )
  }

  /** An array literal: `[v, v, …]`. */
  parseArray(): TypedValue {
    this.expectPunct('[')
    const items: TypedValue[] = []
    if (!this.acceptPunct(']')) {
      for (;;) {
        items.push(this.parseComplexOrStructure())
        if (this.acceptPunct(']')) break
        if (this.peek() === undefined) {
          throw new ToolError(
            `character ${this.source.length + 1}: the array is missing its closing ']'`,
            ToolErrorCode.ParseSyntax,
          )
        }
        this.expectPunct(',')
      }
    }
    return { type: 'array', value: items }
  }

  /** An object literal: `{key: v, …}` — a key is a literal name, never an expression. */
  parseObject(): TypedValue {
    this.expectPunct('{')
    const fields: Record<string, TypedValue> = {}
    if (!this.acceptPunct('}')) {
      for (;;) {
        const key = this.next()
        if (key === undefined || key.kind !== 'word') {
          throw new ToolError(`character ${(key?.at ?? this.source.length) + 1}: expected a field name`, ToolErrorCode.ParseSyntax)
        }
        this.expectPunct(':')
        fields[key.text] = this.parseComplexOrStructure()
        if (this.acceptPunct('}')) break
        this.expectPunct(',')
      }
    }
    return { type: 'object', value: fields }
  }

  /** Dispatch on the next token: a structure, a string, or a complex. */
  parseComplexOrStructure(): TypedValue {
    const token = this.peek()
    if (token === undefined) throw new ToolError('the value is empty', ToolErrorCode.ParseSyntax)
    if (token.kind === 'punct' && token.text === '[') return this.parseArray()
    if (token.kind === 'punct' && token.text === '{') return this.parseObject()
    if (token.kind === 'string') {
      this.index += 1
      return { type: 'string', value: token.text }
    }
    return this.parseComplex()
  }
}

/** Parse one value string. Throws a ToolError carrying a fix, never a bare Error. */
export function parseValueString(source: string): TypedValue {
  if (source.trim().length === 0) {
    throw new ToolError('the value is empty — write a quantity such as "4.7kohm", or null to delete the slot', ToolErrorCode.ParseSyntax)
  }
  const parser = new Parser(tokenize(source), source)
  return parser.parseComplexOrStructure()
}
