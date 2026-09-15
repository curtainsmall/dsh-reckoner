import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { attachConsoleSink, attachFileSink, formatLine, log, LogLevel, setLevel, setSinks } from '../src/log.ts'

/** Read the run index the way a script outside the client would. */
function readRuns(index: string): Array<{ name: string; startedAt: number; endedAt: number | null; pid: number; level: string }> {
  return readFileSync(index, 'utf8').split('\n').filter((text) => text.trim().length > 0).map((text) => JSON.parse(text))
}

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
    expect(line('external call failed')).toBe(`${HEAD}external call failed`)
    expect(formatLine(LogLevel.Debug, 'x', undefined, AT)).toBe('2025-06-14 12:03:41.882 DEBUG x')
    expect(formatLine(LogLevel.Info, 'x', undefined, AT)).toBe('2025-06-14 12:03:41.882 INFO  x')
    expect(formatLine(LogLevel.Error, 'x', undefined, AT)).toBe('2025-06-14 12:03:41.882 ERROR x')
  })

  it('renders bare values unquoted and quotes only what carries a separator', () => {
    expect(line('m', { solver: 'echo', took_ms: 1523, ok: true, none: null, ep: 'http://127.0.0.1:8787' }))
      .toBe(`${HEAD}m solver=echo took_ms=1523 ok=true none=null ep=http://127.0.0.1:8787`)
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
  it('writes one event-only run file plus one index row, sealed on close', () => {
    const home = tempHome()
    const run = attachFileSink(home)
    cleanup(() => { run.close() })
    expect(run.file.startsWith(join(home, 'logs'))).toBe(true)
    expect(basename(run.file)).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.\d{3}\.log$/)
    log.warn('external call failed', { code: 'EXTERNAL_TIMEOUT', took_ms: 30001 })
    // the run file carries nothing but events — the run's own state is indexed instead
    expect(readFileSync(run.file, 'utf8'))
      .toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} WARN {2}external call failed code=EXTERNAL_TIMEOUT took_ms=30001\n$/)
    const indexFile = join(home, 'log-index.jsonl')
    const open = readRuns(indexFile)
    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({ name: basename(run.file), endedAt: null, pid: process.pid, level: LogLevel.Info })
    expect(typeof open[0]!.startedAt).toBe('number')
    run.close()
    const closed = readRuns(indexFile)
    expect(closed).toHaveLength(1)
    expect(typeof closed[0]!.endedAt).toBe('number')
    // a closed run receives nothing more, and closing twice adds no row
    log.warn('after close')
    run.close()
    expect(readFileSync(run.file, 'utf8')).not.toContain('after close')
    expect(readRuns(indexFile)).toHaveLength(1)
  })

  it('steps the file name forward instead of reusing a taken one', () => {
    const home = tempHome()
    const first = attachFileSink(home)
    cleanup(() => { first.close() })
    const second = attachFileSink(home)
    cleanup(() => { second.close() })
    expect(second.file).not.toBe(first.file)
    // attaching a new run seals the previous one
    const rows = readRuns(join(home, 'log-index.jsonl'))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ name: basename(first.file), endedAt: expect.any(Number) })
    expect(rows[1]).toMatchObject({ name: basename(second.file), endedAt: null })
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
      // the index keeps a row per run file, including the ones retention is about to drop
      writeFileSync(join(home, 'log-index.jsonl'), '', { flag: 'a' })
      appendFileSync(join(home, 'log-index.jsonl'), `${JSON.stringify({ name, startedAt: 1, endedAt: 1, pid: 1, level: 'info' })}\n`)
    }
    writeFileSync(join(root, 'notes.txt'), 'not a run file')
    const run = attachFileSink(home)
    cleanup(() => { run.close() })
    const kept = readdirSync(root)
    expect(kept).toHaveLength(21)
    expect(kept).toContain(basename(run.file))
    expect(kept).not.toContain(old[0])
    expect(kept).toContain(old[old.length - 1])
    // retention owns the run files only, and their index rows go with them
    expect(kept).toContain('notes.txt')
    const names = readRuns(join(home, 'log-index.jsonl')).map((row) => row.name)
    expect(names).toHaveLength(20)
    expect(names).toContain(basename(run.file))
    expect(names).not.toContain(old[0])
  })
})
