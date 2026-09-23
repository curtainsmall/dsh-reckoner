import { EngineErrorCode } from '../src/errors.ts'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseSkillFile } from '../src/skill.ts'

const read = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

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
    for (const line of read('presets/reckoner/agent.cordis.yml').split('\n')) {
      expect([...line].every((character) => character.codePointAt(0)! <= 126)).toBe(true)
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
