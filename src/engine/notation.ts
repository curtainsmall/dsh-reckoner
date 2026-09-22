/**
 * The `$` notation table: which symbols exist, what shape each one is
 * written in, whether it can be evaluated, and how many arguments it takes.
 * Nothing else in the engine may spell a notation name.
 */
export type NotationClass = 'constant' | 'function' | 'binding'

export interface NotationEntry {
  readonly symbol: string
  readonly notationClass: NotationClass
  /** The argument counts the symbol accepts. */
  readonly arities: readonly number[]
  /** `$integral`, `$limit` and `$diff` are writable but not evaluable. */
  readonly evaluable: boolean
  /** How the symbol is written; the message for a non-evaluable symbol repeats it. */
  readonly form: string
}

function constant(symbol: string): NotationEntry {
  return { symbol, notationClass: 'constant', arities: [0], evaluable: true, form: `${symbol} (a bare name, no arguments)` }
}

function unary(symbol: string): NotationEntry {
  return { symbol, notationClass: 'function', arities: [1], evaluable: true, form: `${symbol}(x)` }
}

function binary(symbol: string): NotationEntry {
  return { symbol, notationClass: 'function', arities: [2], evaluable: true, form: `${symbol}(x, y)` }
}

export const NOTATION: readonly NotationEntry[] = [
  constant('$pi'),
  constant('$e'),
  constant('$inf'),
  constant('$i'),
  constant('$j'),

  unary('$abs'),
  unary('$sqrt'),
  unary('$exp'),
  unary('$ln'),
  unary('$log'),
  unary('$sin'),
  unary('$cos'),
  unary('$tan'),
  unary('$asin'),
  unary('$acos'),
  unary('$atan'),
  unary('$floor'),
  unary('$ceil'),
  unary('$sign'),
  unary('$re'),
  unary('$im'),
  unary('$arg'),
  unary('$conj'),
  unary('$transpose'),
  unary('$len'),

  binary('$atan2'),
  binary('$min'),
  binary('$max'),
  binary('$mod'),

  {
    symbol: '$sum',
    notationClass: 'binding',
    arities: [1],
    evaluable: true,
    form: '$sum_{k=a}^{b}(body) - both bounds are required',
  },
  {
    symbol: '$prod',
    notationClass: 'binding',
    arities: [1],
    evaluable: true,
    form: '$prod_{k=a}^{b}(body) - both bounds are required',
  },
  {
    symbol: '$seq',
    notationClass: 'binding',
    arities: [1],
    evaluable: true,
    form: '$seq_{k=a}^{b}(body) - both bounds are required',
  },
  {
    symbol: '$integral',
    notationClass: 'binding',
    arities: [2],
    evaluable: false,
    form: '$integral_{a}^{b}(body, x) or $integral(body, x)',
  },
  {
    symbol: '$limit',
    notationClass: 'binding',
    arities: [1],
    evaluable: false,
    form: '$limit_{x->a}(body)',
  },
  {
    symbol: '$diff',
    notationClass: 'binding',
    arities: [2, 3],
    evaluable: false,
    form: '$diff(body, x) or $diff(body, x, n)',
  },
]

const NOTATION_INDEX = new Map<string, NotationEntry>()
for (const entry of NOTATION) NOTATION_INDEX.set(entry.symbol, entry)

/** The entry of a notation name, or undefined for a name outside the table. */
export function notationLookup(symbol: string): NotationEntry | undefined {
  return NOTATION_INDEX.get(symbol)
}

/** Every notation name, in table order: the vocabulary a symbol error lists. */
export function notationVocabulary(): string {
  return NOTATION.map((entry) => entry.symbol).join(' ')
}
