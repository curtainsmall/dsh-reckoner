/**
 * The engine's failure codes: the stable machine-readable half of every
 * `{ ok: false, code, error }` receipt. The code identifies the fault; the
 * message is written for the model and must stand alone (the concrete value,
 * the boundary or the expectation, and how to fix it).
 */
export const ENGINE_ERROR_CODES = [
  'ENGINE_INVALID_FORMULA',
  'ENGINE_INVALID_NUMBER',
  'ENGINE_INVALID_IDENTIFIER',
  'ENGINE_INVALID_DIMENSION',
  'ENGINE_INVALID_NOTATION',
  'ENGINE_INVALID_ARITY',
  'ENGINE_SLOT_NOT_FOUND',
  'ENGINE_NAME_NOT_BOUND',
  'ENGINE_INCOMPATIBLE_DIMENSION',
  'ENGINE_UNSUPPORTED_OPERATION',
  'ENGINE_INVALID_INDEX',
  'ENGINE_UNDEFINED_RESULT',
  'ENGINE_UNSUPPORTED_INDEX',
  'ENGINE_FIELD_NOT_FOUND',
  'ENGINE_UNSUPPORTED_SYMBOL',
  'ENGINE_INVALID_ARGS',
  'ENGINE_OPEN_RECORD_NOT_FOUND',
  'ENGINE_OPEN_RECORD_FOUND',
  'ENGINE_UNKNOWN_ERROR',
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
