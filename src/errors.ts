/**
 * The engine's failure codes: the stable machine-readable half of every
 * `{ ok: false, code, error }` receipt. The code identifies the fault; the
 * message is written for the model and must stand alone (the concrete value,
 * the boundary or the expectation, and how to fix it).
 */
export const ENGINE_ERROR_CODES = [
  'ENGINE_PARSE_SYNTAX',
  'ENGINE_PARSE_NUMBER',
  'ENGINE_PARSE_IDENT',
  'ENGINE_PARSE_UNIT',
  'ENGINE_PARSE_SYMBOL',
  'ENGINE_PARSE_ARITY',
  'ENGINE_SLOT_UNDECLARED',
  'ENGINE_IDENT_UNBOUND',
  'ENGINE_DIM_MISMATCH',
  'ENGINE_TYPE_NOT_ARITHMETIC',
  'ENGINE_RANGE_INDEX',
  'ENGINE_RANGE_DOMAIN',
  'ENGINE_NOT_INDEXABLE',
  'ENGINE_NO_FIELD',
  'ENGINE_SYMBOL_NOT_EVALUABLE',
  'ENGINE_ARGS_INVALID',
  'ENGINE_NO_OPEN_RECORD',
  'ENGINE_RECORD_DUPLICATE',
  'ENGINE_TOOL',
] as const

/** One of the engine's stable failure codes. */
export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number]

/** A failure carrying the machine-readable code that goes into the receipt. */
export class EngineError extends Error {
  readonly code: EngineErrorCode

  constructor(code: EngineErrorCode, message: string) {
    super(message)
    this.name = 'EngineError'
    this.code = code
  }
}

/** Throw an engine failure. */
export function fail(code: EngineErrorCode, message: string): never {
  throw new EngineError(code, message)
}

/** Whether a thrown value is an engine failure (anything else is an internal fault). */
export function isEngineError(value: unknown): value is EngineError {
  return value instanceof EngineError
}
