import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { attachConsoleSink, attachFileSink, formatLine, log, LogLevel, setLevel, setSinks } from '../src/log.ts'

/** The local-time instant every formatter assertion is stamped with. */
const AT = new Date(2025, 5, 14, 12, 3, 41, 882)
const HEAD = '2025-06-14 12:03:41.882 WARN  '

const cleanups: Array<() => void> = []

function cleanup(undo: () => void): void {
  cleanups.push(undo)
}

function line(message: string, fields?: object): string {
  return formatLine(LogLevel.Warn, message, fields, AT)
}

/** A throwaway records home; removed after the test. */
function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'elab-log-'))
  cleanup(() => { rmSync(home, { recursive: true, force: true }) })
  return home
}

/** Capture emitted lines into an array, replacing every sink for the duration of the test. */
function capture(): string[] {
  const lines: string[] = []
  cleanup(setSinks({ write: (text) => { lines.push(text) } }))
  return lines
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
  setLevel(LogLevel.Info)
})

describe('formatLine', () => {
  it('renders the head as timestamp, padded level label and message', () => {
    expect(line('engine call failed')).toBe(`${HEAD}engine call failed`)
    expect(formatLine(LogLevel.Debug, 'x', undefined, AT)).toBe('2025-06-14 12:03:41.882 DEBUG x')
    expect(formatLine(LogLevel.Info, 'x', undefined, AT)).toBe('2025-06-14 12:03:41.882 INFO  x')
    expect(formatLine(LogLevel.Error, 'x', undefined, AT)).toBe('2025-06-14 12:03:41.882 ERROR x')
  })

  it('renders bare values unquoted and quotes only what carries a separator', () => {
    expect(line('m', { tool: 'eval', took_ms: 1523, ok: true, none: null, ep: 'http://127.0.0.1:8787' }))
      .toBe(`${HEAD}m tool=eval took_ms=1523 ok=true none=null ep=http://127.0.0.1:8787`)
    expect(line('m', { error: 'two words' })).toBe(`${HEAD}m error="two words"`)
    expect(line('m', { query: 'a=b' })).toBe(`${HEAD}m query="a=b"`)
    expect(line('m', { empty: '' })).toBe(`${HEAD}m empty=""`)
    expect(line('m', { quoted: '"x' })).toBe(`${HEAD}m quoted="\\"x"`)
    expect(line('m', { slash: 'a\\b' })).toBe(`${HEAD}m slash=a\\b`)
    expect(line('m', { nan: NaN, inf: Infinity, neg: -Infinity })).toBe(`${HEAD}m nan=NaN inf=Infinity neg=-Infinity`)
  })

  it('atomizes a nested object or array into a single token', () => {
    const flat = line('m', { opts: { a: 1 } })
    expect(flat).toBe(`${HEAD}m opts={"a":1}`)
    // one `=` for the whole line: the object never became nested k=v
    expect(flat.split('=').length - 1).toBe(1)
    expect(line('m', { opts: { a: 'two words' } })).toBe(`${HEAD}m opts="{\\"a\\":\\"two words\\"}"`)
    expect(line('m', { xs: [1, 2] })).toBe(`${HEAD}m xs=[1,2]`)
    const deep = line('m', { opts: { a: { b: { c: 1 } } } })
    expect(deep).toBe(`${HEAD}m opts={"a":{"b":{"c":1}}}`)
    expect(deep.split('=').length - 1).toBe(1)
  })

  it('expands any object handed in as the field bag exactly one level', () => {
    class Box {
      constructor(readonly a: number, readonly b: string) {}
      hidden(): number { return this.a * 2 }
    }
    expect(line('m', new Box(1, 'x'))).toBe(`${HEAD}m a=1 b=x`)
    expect(line('m', [1, 2])).toBe(`${HEAD}m value=[1,2]`)
    expect(line('m', {})).toBe(`${HEAD}m`)
    expect(line('m', { a: undefined })).toBe(`${HEAD}m`)
    expect(line('m', { a: undefined, b: 1 })).toBe(`${HEAD}m b=1`)
  })

  it('does not run a getter and skips the accessor it hides', () => {
    const fields: Record<string, unknown> = { safe: 1 }
    Object.defineProperty(fields, 'boom', { enumerable: true, get() { throw new Error('getter ran') } })
    expect(line('m', fields)).toBe(`${HEAD}m safe=1`)
  })

  it('renders an Error as its message and appends its stack as continuation lines', () => {
    const bare = line('m', { error: new Error('boom') })
    expect(bare.split('\n')[0]).toBe(`${HEAD}m error=boom`)
    expect(bare.split('\n').length).toBeGreaterThan(1)
    expect(bare.split('\n').slice(1).every((text) => text.startsWith('  | '))).toBe(true)
    // one non-continuation line per event: `grep -v '^  |'` restores the one-line stream
    expect(bare.split('\n').filter((text) => !text.startsWith('  | '))).toHaveLength(1)
    expect(line('m', { error: new Error('two words') })).toContain('error="two words"')
  })

  it('never throws outside the JSON value domain', () => {
    expect(line('m', { big: 10n })).toBe(`${HEAD}m big=[unserializable]`)
    expect(line('m', { fn: () => 1 })).toBe(`${HEAD}m fn=[unserializable]`)
    expect(line('m', { sym: Symbol('s') })).toBe(`${HEAD}m sym=[unserializable]`)
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    expect(line('m', { cycle })).toBe(`${HEAD}m cycle=[unserializable]`)
  })

  it('caps one value and escapes the message', () => {
    const long = 'x'.repeat(300)
    const capped = line('m', { long })
    expect(capped.endsWith('…')).toBe(true)
    expect(capped).toBe(`${HEAD}m long=${'x'.repeat(200)}…`)
    expect(line('two\nlines')).toBe(`${HEAD}two\\nlines`)
    expect(line('m', { v: 'a\nb' })).toBe(`${HEAD}m v="a\\nb"`)
    expect(line('m', { v: 'a\r\nb' })).toBe(`${HEAD}m v="a\\r\\nb"`)
  })
})

describe('level and sinks', () => {
  it('filters below the level and stays silent without a sink', () => {
    expect(() => log.info('no sink attached')).not.toThrow()
    const lines = capture()
    setLevel(LogLevel.Warn)
    log.info('dropped', { a: 1 })
    log.warn('kept')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('WARN  kept')
    setLevel(LogLevel.Off)
    log.error('dropped too')
    expect(lines).toHaveLength(1)
  })

  it('writes every line to stdout through the console sink', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    cleanup(() => { spy.mockRestore() })
    const detach = attachConsoleSink()
    cleanup(detach)
    setLevel(LogLevel.Info)
    log.info('console line', { a: 1 })
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('INFO  console line a=1\n'))
  })
})

describe('file sink', () => {
  it('writes one event-only run file and nothing else', () => {
    const home = tempHome()
    const run = attachFileSink(home)
    cleanup(() => { run.close() })
    expect(run.file.startsWith(join(home, 'logs'))).toBe(true)
    expect(basename(run.file)).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.\d{3}\.log$/)
    log.warn('engine call failed', { code: 'ENGINE_INCOMPATIBLE_DIMENSION', took_ms: 30001 })
    // the run's own record is the file: the name is the start instant, the last line is the end
    expect(readFileSync(run.file, 'utf8'))
      .toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} WARN {2}engine call failed code=ENGINE_INCOMPATIBLE_DIMENSION took_ms=30001\n$/)
    // logging is not plugin state: it writes no state file and no sibling of the log
    expect(existsSync(join(home, 'state.json'))).toBe(false)
    expect(readdirSync(home)).toEqual(['logs'])
    // a closed run receives nothing more, and closing twice changes nothing
    run.close()
    log.warn('after close')
    run.close()
    expect(readFileSync(run.file, 'utf8')).not.toContain('after close')
  })

  it('steps the file name forward instead of reusing a taken one, and keeps each run its own file', () => {
    const home = tempHome()
    const first = attachFileSink(home)
    cleanup(() => { first.close() })
    log.info('plugin mounted')
    const second = attachFileSink(home)
    cleanup(() => { second.close() })
    expect(second.file).not.toBe(first.file)
    // the first run survives as its own file, with its own content
    expect(readFileSync(first.file, 'utf8')).toContain('INFO  plugin mounted')
    expect(readFileSync(second.file, 'utf8')).toBe('')
    expect(readdirSync(join(home, 'logs'))).toHaveLength(2)
  })

  it('never opens an existing log, and reports a clock that cannot name a second run', () => {
    const home = tempHome()
    const logs = join(home, 'logs')
    mkdirSync(logs, { recursive: true })
    // A frozen clock forces the exclusive create to lose the name on every attempt.
    vi.useFakeTimers()
    cleanup(() => { vi.useRealTimers() })
    vi.setSystemTime(new Date(2025, 5, 14, 12, 3, 41, 882))
    const taken = '2025-06-14_12-03-41.882.log'
    writeFileSync(join(logs, taken), 'an earlier run\n')
    expect(() => attachFileSink(home)).toThrow(/already taken/)
    // no invented suffix, and the earlier run's log is untouched: never appended to, never truncated
    expect(readdirSync(logs)).toEqual([taken])
    expect(readFileSync(join(logs, taken), 'utf8')).toBe('an earlier run\n')
  })

  it('keeps the newest runs, never prunes the current one, and leaves other files alone', () => {
    const home = tempHome()
    const root = join(home, 'logs')
    mkdirSync(root, { recursive: true })
    const old: string[] = []
    for (let index = 0; index < 25; index += 1) {
      const name = `2025-01-01_00-00-00.${String(index).padStart(3, '0')}.log`
      old.push(name)
      writeFileSync(join(root, name), '')
    }
    writeFileSync(join(root, 'notes.txt'), 'not a run file')
    const run = attachFileSink(home)
    cleanup(() => { run.close() })
    const kept = readdirSync(root)
    expect(kept).toHaveLength(21)
    expect(kept).toContain(basename(run.file))
    expect(kept).not.toContain(old[0])
    expect(kept).toContain(old[old.length - 1])
    // retention owns the run files only
    expect(kept).toContain('notes.txt')
  })
})
