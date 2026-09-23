/**
 * The formula scanner: one pass over the ASCII source producing number, name,
 * `$notation`, `@slot` and punctuation tokens. Everything outside that
 * charset is refused here, with the position in the message.
 */
import { fail } from '../errors.ts'

/** A scalar literal: `1e5`, `2j` or `4i` - always a plain number, never a quantity. */
export interface ScalarLiteral {
  readonly re: number
  readonly im: number
}

export type TokenKind = 'number' | 'name' | 'symbol' | 'slot' | 'punct' | 'eof'

export interface Token {
  readonly kind: TokenKind
  readonly text: string
  readonly at: number
  readonly scalar?: ScalarLiteral
}

/** Where in the formula something is: 1-based character position, for the model to count along. */
export function formulaPosition(formula: string, at: number): string {
  return `at character ${at + 1} of "${formula}"`
}

/** A token as a message names it. */
export function tokenLabel(token: Token): string {
  if (token.kind === 'eof') return 'the end of the formula'
  if (token.kind === 'symbol') return `the notation "${token.text}"`
  if (token.kind === 'slot') return `the slot "${token.text}"`
  if (token.kind === 'number') return `the number "${token.text}"`
  if (token.kind === 'name') return `the name "${token.text}"`
  return `"${token.text}"`
}

const PUNCTUATION = new Set(['+', '-', '*', '/', '^', '(', ')', '[', ']', '{', '}', ',', '.', '_', '='])

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9'
}

function isNameStart(char: string | undefined): boolean {
  return char !== undefined && ((char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || char === '_')
}

function isNamePart(char: string | undefined): boolean {
  return isNameStart(char) || isDigit(char)
}

/** The whole formula as tokens, ending with one eof token. */
export function tokenize(formula: string): Token[] {
  const tokens: Token[] = []
  let index = 0

  const readName = (): string => {
    const start = index
    index += 1
    while (isNamePart(formula[index])) index += 1
    return formula.slice(start, index)
  }

  while (index < formula.length) {
    const char = formula[index]!
    if (char === ' ' || char === '\t' || char === '\n') {
      index += 1
      continue
    }

    if (isDigit(char)) {
      const start = index
      while (isDigit(formula[index])) index += 1
      if (formula[index] === '.' && isDigit(formula[index + 1])) {
        index += 1
        while (isDigit(formula[index])) index += 1
      }
      if (formula[index] === 'e') {
        let scan = index + 1
        if (formula[scan] === '+' || formula[scan] === '-') scan += 1
        if (!isDigit(formula[scan])) {
          fail(
            'ENGINE_INVALID_NUMBER',
            `${formulaPosition(formula, index)}: "${formula.slice(start, index + 1)}" has no exponent digits - the scientific form is digits, a lowercase "e", then the exponent, as in 1e5. Write "1*$e" to multiply by Euler's number.`,
          )
        }
        while (isDigit(formula[scan])) scan += 1
        index = scan
      }
      const magnitudeText = formula.slice(start, index)
      let imaginary = false
      if (formula[index] === 'i' || formula[index] === 'j') {
        imaginary = true
        index += 1
      }
      if (isNameStart(formula[index])) {
        fail(
          'ENGINE_INVALID_IDENTIFIER',
          `${formulaPosition(formula, start)}: "${formula.slice(start, index + 1)}" is not a valid number - a letter may follow a number only as the imaginary suffix i or j. Write "${magnitudeText}*${formula.slice(index)}" to multiply.`,
        )
      }
      const magnitude = Number(magnitudeText)
      const scalar: ScalarLiteral = imaginary ? { re: 0, im: magnitude } : { re: magnitude, im: 0 }
      tokens.push({ kind: 'number', text: formula.slice(start, index), at: start, scalar })
      continue
    }

    if (isNameStart(char)) {
      const start = index
      // An underscore is a position only directly after a notation name and before its brace: `$sum_{k=a}`.
      if (char === '_' && formula[index + 1] === '{' && tokens[tokens.length - 1]?.kind === 'symbol') {
        tokens.push({ kind: 'punct', text: '_', at: start })
        index += 1
        continue
      }
      const text = readName()
      tokens.push({ kind: 'name', text, at: start })
      continue
    }

    if (char === '$' || char === '@') {
      const start = index
      index += 1
      if (!isNameStart(formula[index])) {
        fail(
          'ENGINE_INVALID_FORMULA',
          char === '$'
            ? `${formulaPosition(formula, start)}: "$" must be followed by a notation name such as $pi, $abs or $sum.`
            : `${formulaPosition(formula, start)}: "@" must be followed by a slot name (a letter or underscore first, then letters, digits or underscores).`,
        )
      }
      let name: string
      if (char === '$') {
        // A notation name stops before an underscore that opens a position: `$sum_{k=a}`.
        const nameStart = index
        while (isNamePart(formula[index]) && !(formula[index] === '_' && formula[index + 1] === '{')) index += 1
        name = formula.slice(nameStart, index)
      } else {
        name = readName()
      }
      tokens.push({ kind: char === '$' ? 'symbol' : 'slot', text: `${char}${name}`, at: start })
      continue
    }

    if (char === '-' && formula[index + 1] === '>') {
      tokens.push({ kind: 'punct', text: '->', at: index })
      index += 2
      continue
    }

    if (PUNCTUATION.has(char)) {
      tokens.push({ kind: 'punct', text: char, at: index })
      index += 1
      continue
    }

    const code = formula.codePointAt(index) ?? 0
    fail(
      'ENGINE_INVALID_FORMULA',
      `${formulaPosition(formula, index)}: the character ${JSON.stringify(char)} (code point ${code}) is not in the formula charset. A formula is ASCII: digits, names, $notation, @slot, whitespace, and the punctuation + - * / ^ ( ) [ ] { } , . _ = -> .`,
    )
  }

  tokens.push({ kind: 'eof', text: '', at: formula.length })
  return tokens
}
