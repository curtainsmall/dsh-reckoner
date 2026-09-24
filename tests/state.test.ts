import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArticleFormat, ArticleLanguage } from '../src/generate.ts'
import { readFormatSettings, writeFormatSettings } from '../src/generate-server.ts'
import {
  clearRestartRequired,
  markRestartRequired,
  migrateStateFile,
  readSection,
  readState,
  restartRequired,
  RESTART_REQUIRED_KEY,
  STATE_FILE,
  STATE_SCHEMA,
  statePath,
  updateSection,
  updateState,
} from '../src/state.ts'

const homes: string[] = []

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'reckoner-state-'))
  homes.push(home)
  return home
}

/** Write one raw state file, exactly as given. */
function writeState(home: string, value: unknown): void {
  writeFileSync(statePath(home), JSON.stringify(value), 'utf8')
}

afterEach(() => {
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true })
})

describe('the state file', () => {
  it('reads a missing file as empty state', () => {
    const home = tempHome()
    expect(readState(home)).toEqual({})
    expect(statePath(home)).toBe(join(home, STATE_FILE))
  })

  it('reads a corrupt or non-object file as empty state', () => {
    const home = tempHome()
    writeFileSync(statePath(home), '{"generation":', 'utf8')
    expect(readState(home)).toEqual({})
    writeFileSync(statePath(home), '[1,2,3]', 'utf8')
    expect(readState(home)).toEqual({})
    writeFileSync(statePath(home), 'null', 'utf8')
    expect(readState(home)).toEqual({})
  })

  it('keeps the keys other writers own, including ones this build does not know', () => {
    const home = tempHome()
    updateSection(home, 'panel', (panel) => { panel.showAll = true })
    updateSection(home, 'generation', (generation) => { generation.latex = { directory: 'D:/tex', compile: true } })
    updateState(home, (state) => { state.futureKey = { from: 'a newer build' } })
    expect(readState(home)).toEqual({
      schema: STATE_SCHEMA,
      panel: { showAll: true },
      generation: { latex: { directory: 'D:/tex', compile: true } },
      futureKey: { from: 'a newer build' },
    })
    // one subtree can be emptied without touching the others
    updateSection(home, 'panel', (panel) => { delete panel.showAll })
    expect(readState(home)).toEqual({
      schema: STATE_SCHEMA,
      generation: { latex: { directory: 'D:/tex', compile: true } },
      futureKey: { from: 'a newer build' },
    })
  })

  it('replaces the file atomically, leaving no temporary behind', () => {
    const home = tempHome()
    updateSection(home, 'panel', (panel) => { panel.showAll = true })
    expect(readFileSync(statePath(home), 'utf8')).toBe(`{"panel":{"showAll":true},"schema":${STATE_SCHEMA}}`)
    expect(readdirSync(home)).toEqual([STATE_FILE])
  })

  it('creates the home directory when it does not exist yet', () => {
    const home = join(tempHome(), 'nested', 'home')
    updateSection(home, 'generation', (generation) => { generation.markdown = { language: 'zh-CN' } })
    expect(readState(home)).toEqual({ schema: STATE_SCHEMA, generation: { markdown: { language: 'zh-CN' } } })
  })
})

describe('the migration to the tree', () => {
  it('moves the flat generation keys into one subtree per format', () => {
    const home = tempHome()
    writeState(home, {
      generateDir: 'D:/out',
      generateLanguage: 'zh-CN',
      generateFormat: 'latex',
      generateCompile: true,
    })
    // read in memory: both formats inherit directory and language, compile goes to LaTeX alone,
    // and `generateFormat` is dropped because nothing ever read it.
    expect(readState(home)).toEqual({
      schema: STATE_SCHEMA,
      generation: {
        markdown: { directory: 'D:/out', language: 'zh-CN' },
        latex: { directory: 'D:/out', language: 'zh-CN', compile: true },
      },
    })
    // the file itself is untouched until something asks for the migration to be written
    expect(JSON.parse(readFileSync(statePath(home), 'utf8'))).toMatchObject({ generateDir: 'D:/out' })
  })

  it('writes the migrated file once and then leaves it alone', () => {
    const home = tempHome()
    writeState(home, { generateDir: 'D:/out' })
    expect(migrateStateFile(home)).toBe(true)
    const migrated = readFileSync(statePath(home), 'utf8')
    expect(JSON.parse(migrated)).toEqual({
      generation: { markdown: { directory: 'D:/out' }, latex: { directory: 'D:/out' } },
      schema: STATE_SCHEMA,
    })
    expect(migrateStateFile(home)).toBe(false)
    expect(readFileSync(statePath(home), 'utf8')).toBe(migrated)
  })

  it('does not invent a file when there is none, and keeps the flat flag where it was', () => {
    const home = tempHome()
    expect(migrateStateFile(home)).toBe(false)
    expect(readdirSync(home)).toEqual([])
    writeState(home, { generateDir: 'D:/out', restartRequired: true })
    expect(migrateStateFile(home)).toBe(true)
    const migrated = JSON.parse(readFileSync(statePath(home), 'utf8')) as Record<string, unknown>
    expect(migrated['restartRequired']).toBe(true)
    expect(migrated['generateDir']).toBeUndefined()
  })

  it('never lowers a schema number a newer build wrote, and preserves its keys', () => {
    const home = tempHome()
    writeState(home, { schema: STATE_SCHEMA + 1, generation: { latex: { directory: 'D:/tex' } }, futureKey: 7 })
    expect(readState(home)).toMatchObject({ schema: STATE_SCHEMA + 1, futureKey: 7 })
    // the migration pass leaves it alone too: nothing to write, and nothing downgraded
    expect(migrateStateFile(home)).toBe(false)
    expect(JSON.parse(readFileSync(statePath(home), 'utf8'))).toMatchObject({ schema: STATE_SCHEMA + 1, futureKey: 7 })
  })

  it('stamps the current schema on a file that has none or an older one', () => {
    const home = tempHome()
    writeState(home, { schema: STATE_SCHEMA - 1, panel: { showAll: true } })
    expect(readState(home).schema).toBe(STATE_SCHEMA)
    expect(migrateStateFile(home)).toBe(true)
    expect(JSON.parse(readFileSync(statePath(home), 'utf8'))).toMatchObject({ schema: STATE_SCHEMA, panel: { showAll: true } })
  })
})

describe('one format remembers its own settings', () => {
  it('writes and reads each format separately, with the defaults applied', () => {
    const home = tempHome()
    expect(readFormatSettings(home, ArticleFormat.Markdown)).toEqual({
      directory: '',
      language: ArticleLanguage.Auto,
      compile: false,
    })

    writeFormatSettings(home, ArticleFormat.Latex, { directory: 'D:/tex', language: ArticleLanguage.ZhCN, compile: true })
    writeFormatSettings(home, ArticleFormat.Markdown, { directory: 'D:/md' })
    expect(readFormatSettings(home, ArticleFormat.Latex)).toEqual({
      directory: 'D:/tex',
      language: ArticleLanguage.ZhCN,
      compile: true,
    })
    expect(readFormatSettings(home, ArticleFormat.Markdown)).toEqual({
      directory: 'D:/md',
      language: ArticleLanguage.Auto,
      compile: false,
    })
  })

  it('never stores a compile flag for markdown, and drops values that mean "default again"', () => {
    const home = tempHome()
    writeFormatSettings(home, ArticleFormat.Markdown, { compile: true, language: 'klingon', directory: '  ' })
    expect(readSection(home, 'generation').markdown).toBeUndefined()
    writeFormatSettings(home, ArticleFormat.Latex, { compile: false })
    expect(readSection(home, 'generation').latex).toEqual({ compile: false })
    writeFormatSettings(home, ArticleFormat.Latex, { directory: '  D:/tex  ' })
    expect(readFormatSettings(home, ArticleFormat.Latex).directory).toBe('D:/tex')
  })

  it('falls back to the legacy plain-text directory while it is still around', () => {
    const home = tempHome()
    writeFileSync(join(home, 'generate-dir.txt'), 'D:/legacy\n', 'utf8')
    expect(readFormatSettings(home, ArticleFormat.Latex).directory).toBe('D:/legacy')
    // the first write replaces it, and the file is removed
    writeFormatSettings(home, ArticleFormat.Latex, { directory: 'D:/tex' })
    expect(readdirSync(home)).toEqual([STATE_FILE])
  })
})

describe('the pending-restart flag', () => {
  it('reads as false when nothing was marked, whatever the file holds', () => {
    const home = tempHome()
    expect(restartRequired(home)).toBe(false)
    writeState(home, { generation: { latex: { directory: 'D:/tex' } } })
    expect(restartRequired(home)).toBe(false)
    writeState(home, { [RESTART_REQUIRED_KEY]: 'yes' })
    expect(restartRequired(home)).toBe(false)
    writeFileSync(statePath(home), '{"generation":', 'utf8')
    expect(restartRequired(home)).toBe(false)
  })

  it('marks the change while every other key survives', () => {
    const home = tempHome()
    updateSection(home, 'generation', (generation) => { generation.latex = { directory: 'D:/tex' } })
    markRestartRequired(home)
    expect(restartRequired(home)).toBe(true)
    expect(readState(home)).toEqual({
      schema: STATE_SCHEMA,
      generation: { latex: { directory: 'D:/tex' } },
      [RESTART_REQUIRED_KEY]: true,
    })
    // idempotent
    markRestartRequired(home)
    expect(readState(home)[RESTART_REQUIRED_KEY]).toBe(true)
  })

  it('clears the flag and removes the key, keeping the rest of the state', () => {
    const home = tempHome()
    updateSection(home, 'generation', (generation) => { generation.latex = { directory: 'D:/tex' } })
    markRestartRequired(home)
    clearRestartRequired(home)
    expect(restartRequired(home)).toBe(false)
    expect(readState(home)).toEqual({ schema: STATE_SCHEMA, generation: { latex: { directory: 'D:/tex' } } })
  })

  it('leaves a file without the flag untouched, so an ordinary mount writes nothing', () => {
    const home = tempHome()
    updateSection(home, 'generation', (generation) => { generation.latex = { directory: 'D:/tex' } })
    const before = readFileSync(statePath(home), 'utf8')
    clearRestartRequired(home)
    expect(readFileSync(statePath(home), 'utf8')).toBe(before)
    // a home with no state file at all stays without one
    const empty = tempHome()
    clearRestartRequired(empty)
    expect(readdirSync(empty)).toEqual([])
  })
})
