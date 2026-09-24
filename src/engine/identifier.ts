/** The one name rule: slots, object fields and bound variables share it. */
import { EngineErrorCode, fail } from '../errors.ts'
import { describe } from './describe.ts'

export const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export function isIdentifier(text: string): boolean {
  return IDENTIFIER_PATTERN.test(text)
}

/** The identifier, or ENGINE_INVALID_IDENTIFIER naming what was given instead. */
export function requireIdentifier(input: unknown, what: string): string {
  if (typeof input !== 'string') {
    fail(
      EngineErrorCode.InvalidIdentifier,
      `${what} must be an identifier string (letters, digits and underscore, starting with a letter or underscore); got ${describe(input)}.`,
    )
  }
  if (!isIdentifier(input)) {
    fail(
      EngineErrorCode.InvalidIdentifier,
      `${what}: "${input}" is not an identifier - it must start with a letter or underscore and continue with letters, digits or underscores only.`,
    )
  }
  return input
}
