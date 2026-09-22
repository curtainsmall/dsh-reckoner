/** Compact rendering of a tool argument for an error message: JSON where possible, a type word otherwise. */
export function describe(input: unknown): string {
  if (input === undefined) return 'nothing'
  if (input === null) return 'null'
  if (typeof input === 'string') return `"${input}"`
  if (typeof input === 'number' || typeof input === 'boolean' || typeof input === 'bigint') return String(input)
  if (typeof input === 'function' || typeof input === 'symbol') return typeof input
  try {
    const text = JSON.stringify(input)
    if (text === undefined) return typeof input
    return text.length > 200 ? `${text.slice(0, 200)}...` : text
  } catch {
    return '[unserializable]'
  }
}
