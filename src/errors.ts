/**
 * The engine's failure codes: the stable machine-readable half of every
 * `{ ok: false, code, error }` receipt. The code identifies the fault; the
 * message is written for the model and must stand alone (the concrete value,
 * the boundary or the expectation, and how to fix it).
 *
 * The enum carries the codes; `ENGINE_ERROR_CODES` is the same values as a list,
 * for the tables that assert on the whole set.
 */
export enum EngineErrorCode {
  InvalidFormula = 'ENGINE_INVALID_FORMULA',
  InvalidNumber = 'ENGINE_INVALID_NUMBER',
  InvalidIdentifier = 'ENGINE_INVALID_IDENTIFIER',
  InvalidDimension = 'ENGINE_INVALID_DIMENSION',
  InvalidNotation = 'ENGINE_INVALID_NOTATION',
  InvalidArity = 'ENGINE_INVALID_ARITY',
  SlotNotFound = 'ENGINE_SLOT_NOT_FOUND',
  NameNotBound = 'ENGINE_NAME_NOT_BOUND',
  IncompatibleDimension = 'ENGINE_INCOMPATIBLE_DIMENSION',
  UnsupportedOperation = 'ENGINE_UNSUPPORTED_OPERATION',
  InvalidIndex = 'ENGINE_INVALID_INDEX',
  UndefinedResult = 'ENGINE_UNDEFINED_RESULT',
  UnsupportedIndex = 'ENGINE_UNSUPPORTED_INDEX',
  FieldNotFound = 'ENGINE_FIELD_NOT_FOUND',
  UnsupportedSymbol = 'ENGINE_UNSUPPORTED_SYMBOL',
  InvalidArgs = 'ENGINE_INVALID_ARGS',
  OpenRecordNotFound = 'ENGINE_OPEN_RECORD_NOT_FOUND',
  OpenRecordFound = 'ENGINE_OPEN_RECORD_FOUND',
  UnknownError = 'ENGINE_UNKNOWN_ERROR',
}

/** The same values as a list, in declaration order. */
export const ENGINE_ERROR_CODES: readonly EngineErrorCode[] = Object.values(EngineErrorCode)

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
