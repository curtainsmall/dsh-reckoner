/**
 * The notation table: every `$` name the engine understands, its arity, and
 * whether it can be evaluated.
 *
 * `$` is the engine's namespace, so a user name (`sum`, `abs`) never collides
 * with a notation. A name that is not in this table is a parse error, not an
 * "unknown function" discovered at run time — the model gets told immediately,
 * with the vocabulary.
 *
 * `$integral`, `$diff` and `$limit` are in the table and parse, but this engine
 * cannot evaluate them: they report ENGINE_SYMBOL_NOT_EVALUABLE. They exist so a
 * formula can still *say* what it means.
 */

/** How a notation is written. */
export enum SymbolForm {
  /** `$name` — a constant. */
  Constant = 'constant',
  /** `$name(args)` — a function. */
  Function = 'function',
  /** `$name_{...}^{...}(body)` — a binder with subscript and superscript positions. */
  Binder = 'binder',
}

export interface SymbolInfo {
  form: SymbolForm
  /**
   * Positional arity for a function, or the arity of the parenthesised body for
   * a binder. `[min, max]`; max null means "unbounded".
   */
  arity?: readonly [number, number | null]
  /** False when the notation parses but this engine cannot evaluate it. */
  evaluable: boolean
  /** What the notation means, in one line, for the error that lists the vocabulary. */
  summary: string
  /**
   * How the notation is written, shown verbatim in an error when it is misused.
   * The shape matters more than the name here: `$limit_{x->a}(body)` is not
   * something a model guesses.
   */
  writeAs?: string
}

/** The constants. */
export const CONSTANTS: Readonly<Record<string, string>> = {
  pi: 'the ratio of a circle to its diameter',
  e: 'the base of the natural logarithm',
  inf: 'infinity',
  i: 'the imaginary unit',
  j: 'the imaginary unit (engineering spelling)',
}

/** One-argument functions. */
const UNARY: Readonly<Record<string, string>> = {
  abs: 'absolute value',
  sqrt: 'square root',
  exp: 'e raised to the argument',
  ln: 'natural logarithm',
  log: 'logarithm base 10',
  sin: 'sine of a dimensionless value or an angle',
  cos: 'cosine of a dimensionless value or an angle',
  tan: 'tangent of a dimensionless value or an angle',
  asin: 'inverse sine, result in radians',
  acos: 'inverse cosine, result in radians',
  atan: 'inverse tangent, result in radians',
  floor: 'largest integer not greater than the argument',
  ceil: 'smallest integer not less than the argument',
  sign: 'sign of the argument: -1, 0 or 1',
  re: 'real part',
  im: 'imaginary part',
  arg: 'argument (phase) in radians',
  conj: 'complex conjugate',
  transpose: 'transpose of a matrix given as arrays of arrays',
}

/** Two-argument functions. */
const BINARY: Readonly<Record<string, string>> = {
  atan2: 'angle of the point (x, y), in radians',
  min: 'smaller of two values of the same kind',
  max: 'larger of two values of the same kind',
  mod: 'remainder of a divided by b',
}

/** The binding notations, with the positions each one defines. */
const BINDERS: Readonly<Record<string, { summary: string; writeAs: string }>> = {
  sum: {
    summary: 'Σ: sum the body as the subscript variable runs from the lower to the upper bound',
    writeAs: '$sum_{k=a}^{b}(body)',
  },
  prod: {
    summary: 'Π: multiply the body over the same range',
    writeAs: '$prod_{k=a}^{b}(body)',
  },
  seq: {
    summary: 'build an array from the body over the same range',
    writeAs: '$seq_{k=a}^{b}(body)',
  },
  integral: {
    summary: '∫: parsed, not evaluated by this engine',
    writeAs: '$integral_{a}^{b}(body, x)',
  },
  limit: {
    summary: 'lim: parsed, not evaluated by this engine',
    writeAs: '$limit_{x->a}(body)',
  },
}

const EVALUABLE_BINDERS = new Set(['sum', 'prod', 'seq'])

export const SYMBOLS: Readonly<Record<string, SymbolInfo>> = {
  ...Object.fromEntries(
    Object.entries(CONSTANTS).map(([name, summary]) => [name, { form: SymbolForm.Constant, evaluable: true, summary, writeAs: `$${name}` }]),
  ),
  ...Object.fromEntries(
    Object.entries(UNARY).map(([name, summary]) => [name, {
      form: SymbolForm.Function, arity: [1, 1] as const, evaluable: true, summary, writeAs: `$${name}(x)`,
    }]),
  ),
  ...Object.fromEntries(
    Object.entries(BINARY).map(([name, summary]) => [name, {
      form: SymbolForm.Function, arity: [2, 2] as const, evaluable: true, summary, writeAs: `$${name}(x, y)`,
    }]),
  ),
  // `diff` is written `$diff(body, x[, n])`: a body plus the variable, optionally the order.
  diff: {
    form: SymbolForm.Function,
    arity: [2, 3],
    evaluable: false,
    summary: BINDERS.diff?.summary ?? 'd/dx: parsed, not evaluated by this engine',
    writeAs: '$diff(body, x)',
  },
  ...Object.fromEntries(
    Object.entries(BINDERS)
      .filter(([name]) => name !== 'diff')
      .map(([name, info]) => [name, {
        form: SymbolForm.Binder,
        arity: [1, 1] as const,
        evaluable: EVALUABLE_BINDERS.has(name),
        summary: info.summary,
        writeAs: info.writeAs,
      }]),
  ),
}

/** The `$` names, for an error message that has to list them. */
export function symbolVocabulary(): string {
  const named = (names: string[], write = false): string => names
    .map((name) => {
      const info = SYMBOLS[name]
      return write && info?.writeAs !== undefined ? info.writeAs : `$${name}`
    })
    .join(' ')
  return [
    `constants: ${named(Object.keys(CONSTANTS))}`,
    `functions: ${named(Object.keys(UNARY))} ${named(Object.keys(BINARY))} ${SYMBOLS.diff?.writeAs ?? '$diff'}`,
    `binders: ${named(Object.keys(BINDERS), true)}`,
  ].join('; ')
}
