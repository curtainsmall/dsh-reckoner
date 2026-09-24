/**
 * The settings surface the Reckoner panel's Settings tab reads and writes: one endpoint pair over
 * the state tree, the generation subtrees per format, the search policy's three layers, and the
 * flat pending-restart marker.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArticleFormat, ArticleLanguage } from '../src/generate.ts'
import { readFormatSettings } from '../src/generate-server.ts'
import { applySettings, settingsView, SETTINGS_PATH } from '../src/settings.ts'
import { resolveEffectiveSearchPolicy } from '../src/search/effective.ts'
import { SearchTier } from '../src/engine/search.ts'
import { markRestartRequired, readSection, readState, statePath } from '../src/state.ts'

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'reckoner-settings-'))
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

interface SearchView {
  defaults: { tier: string; allowedHosts: string[]; maxResults: number; enrich: { pages: number } }
  preset: unknown
  override: Record<string, unknown>
  effective: { tier: string; allowedHosts: string[]; maxResults: number; enrich: { pages: number }; maxSearchesPerRecord: number }
}

interface SettingsView {
  generation: {
    markdown: { directory: string; language: string }
    latex: { directory: string; language: string; compile: boolean }
  }
  search: SearchView
  panel: { showAll: boolean }
  restartRequired: boolean
}

function view(): SettingsView {
  return settingsView(home) as unknown as SettingsView
}

describe('the settings view', () => {
  it('serves every section with its defaults applied and no pending restart', () => {
    const body = view()
    expect(body.generation.markdown).toEqual({ directory: '', language: ArticleLanguage.Auto })
    expect(body.generation.latex).toEqual({ directory: '', language: ArticleLanguage.Auto, compile: false })
    expect(body.search.defaults.tier).toBe(SearchTier.Strict)
    expect(body.search.defaults.allowedHosts).toContain('nist.gov')
    expect(body.search.override).toEqual({})
    expect(body.search.effective).toEqual(body.search.defaults)
    expect(body.panel).toEqual({ showAll: false })
    expect(body.restartRequired).toBe(false)
    expect(SETTINGS_PATH).toBe('/api/dsh-reckoner/settings')
  })

  it('reports the pending-restart flag as it stands', () => {
    markRestartRequired(home)
    expect(view().restartRequired).toBe(true)
  })
})

describe('writing one format', () => {
  it('stores the named fields and leaves the other format alone', () => {
    expect(applySettings(home, { generation: { format: 'latex', directory: 'D:/tex', language: 'zh-CN', compile: true } })).toBeUndefined()
    expect(applySettings(home, { generation: { format: 'markdown', directory: 'D:/md' } })).toBeUndefined()

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
    expect(view().generation.latex).toEqual({ directory: 'D:/tex', language: 'zh-CN', compile: true })
  })

  it('refuses a body without a usable format, and writes nothing when it refuses', () => {
    expect(applySettings(home, { generation: { directory: 'D:/x' } })).toContain('format')
    expect(applySettings(home, { generation: 'latex' })).toContain('generation must be an object')
    expect(view().generation.latex.directory).toBe('')
    expect(readState(home).generation).toBeUndefined()
  })

  it('never stores a compile flag for markdown', () => {
    applySettings(home, { generation: { format: 'markdown', compile: true } })
    expect(readSection(home, 'generation').markdown).toBeUndefined()
  })

  it('refuses a body that is not an object at all', () => {
    expect(applySettings(home, undefined)).toBe('the settings body must be an object')
    expect(applySettings(home, ['generation'])).toBe('the settings body must be an object')
  })
})

describe('writing the search policy', () => {
  it('layers the override over the preset over the defaults', () => {
    // A preset row ships a boundary of its own; nothing has run yet, so only defaults apply.
    expect(view().search.effective.tier).toBe(SearchTier.Strict)
    applySettings(home, { search: { maxResults: 20 } })
    expect(view().search.override).toEqual({ maxResults: 20 })
    expect(view().search.effective.maxResults).toBe(20)
    expect(view().search.defaults.maxResults).not.toBe(20)
  })

  it('merges a nested layer field by field so naming one keeps the other', () => {
    applySettings(home, { search: { enrich: { pages: 3, charsPerPage: 9000 } } })
    applySettings(home, { search: { enrich: { pages: 5 } } })
    expect(readSection(home, 'search').enrich).toEqual({ pages: 5, charsPerPage: 9000 })
  })

  it('clears one field with null and every field with a null section', () => {
    applySettings(home, { search: { tier: 'open', maxResults: 7, enrich: { pages: 2 } } })
    applySettings(home, { search: { tier: null } })
    expect(readSection(home, 'search').tier).toBeUndefined()
    expect(view().search.effective.tier).toBe(SearchTier.Strict)
    applySettings(home, { search: null })
    // the subtree is gone from the file; the reader still answers with an empty object
    expect(readState(home).search).toBeUndefined()
    expect(readSection(home, 'search')).toEqual({})
  })

  it('keeps an override that names a field the policy does not know', () => {
    // Forward compatibility: a newer tab may write fields this build never reads.
    applySettings(home, { search: { futureKnob: 3 } })
    expect(readSection(home, 'search')).toEqual({ futureKnob: 3 })
  })
})

describe('writing the panel section', () => {
  it('stores true and drops the key when it goes back to false', () => {
    applySettings(home, { panel: { showAll: true } })
    expect(readSection(home, 'panel')).toEqual({ showAll: true })
    expect(view().panel).toEqual({ showAll: true })
    applySettings(home, { panel: { showAll: false } })
    expect(readState(home).panel).toBeUndefined()
    expect(readSection(home, 'panel')).toEqual({})
  })

  it('refuses a value that is not a boolean', () => {
    expect(applySettings(home, { panel: { showAll: 'yes' } })).toContain('boolean')
    expect(readSection(home, 'panel')).toEqual({})
  })
})

describe('the policy the search feature actually uses', () => {
  it('lets the override win over the preset row, per call', () => {
    const rowConfig = { tier: 'strict', maxResults: 6, enrich: { pages: 0 } }
    const before = resolveEffectiveSearchPolicy(home, rowConfig)
    expect(before.maxResults).toBe(6)
    expect(before.enrich.pages).toBe(0)

    // A settings write reaches the very next resolution - no restart, no new session.
    applySettings(home, { search: { maxResults: 30, enrich: { pages: 2 } } })
    const after = resolveEffectiveSearchPolicy(home, rowConfig)
    expect(after.maxResults).toBe(30)
    expect(after.enrich.pages).toBe(2)
    // fields the override does not name keep the preset's value
    expect(after.tier).toBe(before.tier)
    expect(after.answerMaxChars).toBe(before.answerMaxChars)
  })

  it('remembers the preset row for the view even when a call passes none', () => {
    const rowConfig = { tier: 'open', allowedHosts: ['example.com'] }
    resolveEffectiveSearchPolicy(home, rowConfig)
    expect(view().search.preset).toEqual(rowConfig)
    expect(view().search.effective.tier).toBe(SearchTier.Open)
  })
})

describe('a state file that an older build wrote', () => {
  it('is migrated by the view without losing the values', () => {
    writeFileSync(statePath(home), JSON.stringify({ generateDir: 'D:/out', generateLanguage: 'en' }), 'utf8')
    const body = view()
    expect(body.generation.markdown).toEqual({ directory: 'D:/out', language: 'en' })
    expect(body.generation.latex).toEqual({ directory: 'D:/out', language: 'en', compile: false })
  })
})
