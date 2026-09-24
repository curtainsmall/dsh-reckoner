import { EngineErrorCode } from '../src/errors.ts'
import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installPresets } from '../src/preset.ts'
import { parseSkillFile } from '../src/skill.ts'

const read = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

describe('the packaged presets', () => {
  /** The persona prefix of one packaged preset, as it appears in its composition file. */
  const personaOf = (id: string): string => {
    const text = read(`presets/${id}/agent.cordis.yml`)
    const start = text.indexOf('prefix: |-')
    expect(start).toBeGreaterThan(-1)
    return text.slice(start + 'prefix: |-'.length)
  }

  it('ships the pure preset and the search preset side by side', () => {
    expect(read('presets/reckoner/preset.yml')).toContain('name: Reckoner')
    expect(read('presets/reckoner-with-search/preset.yml')).toContain('name: Reckoner with search')
    // The pure preset mounts the persona only; the search preset adds exactly one row.
    expect(read('presets/reckoner/agent.cordis.yml')).not.toContain('dsh-reckoner/search')
    expect(read('presets/reckoner-with-search/agent.cordis.yml')).toContain("name: 'dsh-reckoner/search'")
    // Neither mounts a generic web tool: the model must not be able to search or fetch on its own.
    for (const id of ['reckoner', 'reckoner-with-search']) {
      expect(read(`presets/${id}/agent.cordis.yml`)).not.toContain('dsh-tool-web')
    }
  })

  /**
   * The two presets share one persona: rules 1 to 7 and the skill paragraph are
   * copied verbatim, so the search preset can only differ where it means to.
   * This is the guard against the two drifting apart.
   */
  it('keeps the shared persona identical and adds only the search rules', () => {
    const pure = personaOf('reckoner')
    const withSearch = personaOf('reckoner-with-search')
    const sharedEnd = pure.indexOf('\n\n      Before your first formula load')
    expect(sharedEnd).toBeGreaterThan(-1)
    const pureShared = pure.slice(0, sharedEnd)
    expect(withSearch.slice(0, sharedEnd)).toBe(pureShared)
    const extra = withSearch.slice(sharedEnd, withSearch.indexOf('\n\n      Before your first formula load', sharedEnd))
    expect(extra).toContain('8. When a quantity cannot come from the user')
    expect(extra).toContain('9. search is for facts, never for arithmetic')
    expect(extra).toContain('10. Every lookup writes its own row')
    // The closing paragraph is shared too.
    expect(withSearch).toContain(pure.slice(sharedEnd))
  })

  it('carries the lookup policy in the search preset row', () => {
    const cordis = read('presets/reckoner-with-search/agent.cordis.yml')
    expect(cordis).toContain('tier: strict')
    expect(cordis).toContain('maxSearchesPerRecord: 4')
    expect(cordis).toContain('allowedHosts:')
    expect(cordis).toContain('maxTokens: 800')
  })
})

describe('the packaged preset', () => {
  it('declares the picker line and mounts one persona row', () => {
    expect(read('presets/reckoner/preset.yml')).toContain('name: Reckoner')
    const cordis = read('presets/reckoner/agent.cordis.yml')
    expect(cordis).toContain("- id: persona")
    expect(cordis).toContain("name: '@deepseek-ai/dsh-persona'")
    expect(cordis).toContain('complete: true')
    expect(cordis).toContain('includeRuntimeContext: false')
  })

  it('carries the standing rules', () => {
    const persona = read('presets/reckoner/agent.cordis.yml')
    expect(persona).toContain('1. Use only the tools listed for this session')
    expect(persona).toContain('2. Every input quantity comes from the user')
    expect(persona).toContain('3. Gate first')
    expect(persona).toContain('4. Check every receipt')
    expect(persona).toContain('5. Store every quantity with set')
    expect(persona).toContain("6. eval's target is the slot the result is written into")
    expect(persona).toContain('7. When the question holds several sub-questions')
  })

  /**
   * The persona plugin's config schema is `prefix` (required), `suffix`,
   * `complete` and `includeRuntimeContext`; a row passing any other key makes
   * the whole preset fail to mount, and the picker still lists it (discovery
   * health only resolves plugin names). So the keys are pinned here.
   */
  it('configures the persona only with keys the persona plugin accepts', () => {
    const lines = read('presets/reckoner/agent.cordis.yml').split(/\r?\n/)
    const configAt = lines.findIndex((line) => line.trim() === 'config:')
    expect(configAt).toBeGreaterThan(-1)
    const keys = lines
      .slice(configAt + 1)
      .filter((line) => /^ {4}\S/.test(line))
      .map((line) => line.trim().split(':')[0] ?? '')
    expect(keys).toContain('prefix')
    for (const key of keys) {
      expect(['prefix', 'suffix', 'complete', 'includeRuntimeContext']).toContain(key)
    }
    expect(keys).not.toContain('text')
  })

  it('points at the two skills', () => {
    const persona = read('presets/reckoner/agent.cordis.yml')
    expect(persona).toContain('reckoner-interface')
    expect(persona).toContain('reckoner-template')
  })

  it('is ASCII, as every model-facing text is', () => {
    for (const id of ['reckoner', 'reckoner-with-search']) {
      for (const line of read(`presets/${id}/agent.cordis.yml`).split('\n')) {
        expect([...line].every((character) => character.codePointAt(0)! <= 126)).toBe(true)
      }
    }
  })
})

describe('the packaged preset installation', () => {
  /**
   * The plugin ships every preset under its own `presets/` directory and syncs
   * them on mount, so a new preset needs no code at all - only its directory.
   * This pins that: both presets, both files, into the user's preset root.
   */
  it('syncs every packaged preset into the user preset root', () => {
    const home = mkdtempSync(join(tmpdir(), 'reckoner-dsh-'))
    const previous = process.env['DSH_HOME']
    process.env['DSH_HOME'] = home
    try {
      expect([...installPresets()].sort()).toEqual(['reckoner', 'reckoner-with-search'])
      for (const id of ['reckoner', 'reckoner-with-search']) {
        expect(existsSync(join(home, '.agent-presets', id, 'agent.cordis.yml'))).toBe(true)
        expect(existsSync(join(home, '.agent-presets', id, 'preset.yml'))).toBe(true)
      }
    } finally {
      if (previous === undefined) delete process.env['DSH_HOME']
      else process.env['DSH_HOME'] = previous
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('the packaged skills', () => {
  it('parses the manual and carries its seven sections', () => {
    const skill = parseSkillFile(read('skills/reckoner-interface.md'))
    expect(skill.name).toBe('reckoner-interface')
    expect(skill.description.length).toBeGreaterThan(0)
    for (const heading of ['## Values', '## Tools', '## Receipts and errors', '## Record markers', '## Notation', '## Dimensions', '## Discipline']) {
      expect(skill.content).toContain(heading)
    }
  })

  it('parses the record protocol', () => {
    const skill = parseSkillFile(read('skills/reckoner-template.md'))
    expect(skill.name).toBe('reckoner-template')
    for (const marker of ['record_start', 'record_message', 'record_end']) {
      expect(skill.content).toContain(marker)
    }
    expect(skill.content).toContain('are refused until')
  })

  it('names every error code in the manual', () => {
    const skill = parseSkillFile(read('skills/reckoner-interface.md'))
    for (const code of [
      EngineErrorCode.InvalidFormula,
      EngineErrorCode.InvalidNumber,
      EngineErrorCode.InvalidIdentifier,
      EngineErrorCode.InvalidDimension,
      EngineErrorCode.InvalidNotation,
      EngineErrorCode.InvalidArity,
      EngineErrorCode.SlotNotFound,
      EngineErrorCode.NameNotBound,
      EngineErrorCode.IncompatibleDimension,
      EngineErrorCode.UnsupportedOperation,
      EngineErrorCode.InvalidIndex,
      EngineErrorCode.UndefinedResult,
      EngineErrorCode.UnsupportedIndex,
      EngineErrorCode.FieldNotFound,
      EngineErrorCode.UnsupportedSymbol,
      EngineErrorCode.InvalidArgs,
      EngineErrorCode.OpenRecordNotFound,
      EngineErrorCode.OpenRecordFound,
      EngineErrorCode.UnknownError,
    ]) {
      expect(skill.content).toContain(code)
    }
  })

  it('keeps both skills ASCII', () => {
    for (const file of ['skills/reckoner-interface.md', 'skills/reckoner-template.md']) {
      expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(read(file))).toBe(true)
    }
  })
})
