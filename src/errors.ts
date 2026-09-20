/**
 * Stable machine-readable failure kinds carried by a ToolError.
 *
 * Naming is `ENGINE_<position>_<reason>`: the position segment says where the
 * failure happened, so a reader knows what to change — the formula text, a
 * name, or a dimension. The code is what the trace, tests and UI match on; the
 * message is the text that reaches the model, and it must always carry a
 * concrete value and a fix (see the design document, §12.13).
 */
export enum ToolErrorCode {
  /* ── PARSE: the source text is not valid ─────────────────────────────── */
  /** Structural: unbalanced or missing tokens. */
  ParseSyntax = 'ENGINE_PARSE_SYNTAX',
  /** A number literal is malformed (`2e`, `1E5`). */
  ParseNumber = 'ENGINE_PARSE_NUMBER',
  /** An identifier is malformed (`1R`). */
  ParseIdent = 'ENGINE_PARSE_IDENT',
  /** A unit, prefix or variant word is not accepted (`5m`, `4.7kΩ`). */
  ParseUnit = 'ENGINE_PARSE_UNIT',
  /** `$` is followed by a name that is not in the notation table, or a function without parentheses. */
  ParseSymbol = 'ENGINE_PARSE_SYMBOL',
  /** A notation was given the wrong number of arguments. */
  ParseArity = 'ENGINE_PARSE_ARITY',

  /* ── SLOT / IDENT: names ─────────────────────────────────────────────── */
  /** Slot: a referenced slot does not exist. */
  SlotUndeclared = 'ENGINE_SLOT_UNDECLARED',
  /** Slot: the value's kind conflicts with the slot's pinned kind. */
  SlotKind = 'ENGINE_SLOT_KIND',
  /** Ident: a bare identifier is not bound by any notation. */
  IdentUnbound = 'ENGINE_IDENT_UNBOUND',

  /* ── DIM / TYPE: the mathematics does not line up ────────────────────── */
  /** The derived dimension does not match the target kind. */
  DimMismatch = 'ENGINE_DIM_MISMATCH',
  /** An array's elements are not of one kind. */
  TypeMixedKind = 'ENGINE_TYPE_MIXED_KIND',
  /** A non-arithmetic value (an object) took part in arithmetic. */
  TypeNotArithmetic = 'ENGINE_TYPE_NOT_ARITHMETIC',

  /* ── RANGE: a value is outside its allowed set ───────────────────────── */
  /** An index is outside the array. */
  RangeIndex = 'ENGINE_RANGE_INDEX',
  /** A function was applied outside its domain (`$ln(-1)`, division by zero). */
  RangeDomain = 'ENGINE_RANGE_DOMAIN',
  /** A scalar was indexed or traversed by a field path. */
  NotIndexable = 'ENGINE_NOT_INDEXABLE',
  /** An object has no such field. */
  NoField = 'ENGINE_NO_FIELD',

  /* ── SYMBOL / TOOL: notation and generic failures ────────────────────── */
  /** The notation parses but this engine cannot evaluate it (`$integral`, `$diff`, `$limit`). */
  SymbolNotEvaluable = 'ENGINE_SYMBOL_NOT_EVALUABLE',
  /** Arguments do not have the shape the notation or tool expects. */
  ArgsInvalid = 'ENGINE_ARGS_INVALID',
  /** A format asks for a unit or variant that does not express the value's kind. */
  UnsupportedVariant = 'ENGINE_UNSUPPORTED_VARIANT',
  /** Generic tool failure (the default when no code is given). */
  Tool = 'ENGINE_TOOL',
}

/**
 * The unified tool-failure error.
 *
 * Every failure inside TypeScript is a throw: lower layers throw whatever they
 * want — the tool boundary re-wraps any non-ToolError into a ToolError, so
 * every tool call fails through one structured channel.
 */
export class ToolError extends Error {
  readonly code: ToolErrorCode
  constructor(message: string, code: ToolErrorCode = ToolErrorCode.Tool) {
    super(message)
    this.name = 'ToolError'
    this.code = code
  }
}
