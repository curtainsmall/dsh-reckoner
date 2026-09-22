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

  it('carries the six standing rules', () => {
    const persona = read('presets/reckoner/agent.cordis.yml')
    expect(persona).toContain('1. Use only the tools listed for this session')
    expect(persona).toContain('2. Every input quantity comes from the user')
    expect(persona).toContain('3. Gate first')
    expect(persona).toContain('4. Check every receipt')
    expect(persona).toContain('5. Store every quantity with set')
    expect(persona).toContain("6. eval's target is the slot the result is written into")
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
    for (const marker of ['record_question', 'record_analyse', 'record_answer']) {
      expect(skill.content).toContain(marker)
    }
    expect(skill.content).toContain('are refused until')
  })

  it('names every error code in the manual', () => {
    const skill = parseSkillFile(read('skills/reckoner-interface.md'))
    for (const code of [
      'ENGINE_PARSE_SYNTAX',
      'ENGINE_PARSE_NUMBER',
      'ENGINE_PARSE_IDENT',
      'ENGINE_PARSE_UNIT',
      'ENGINE_PARSE_SYMBOL',
      'ENGINE_PARSE_ARITY',
      'ENGINE_SLOT_UNDECLARED',
      'ENGINE_IDENT_UNBOUND',
      'ENGINE_DIM_MISMATCH',
      'ENGINE_TYPE_NOT_ARITHMETIC',
      'ENGINE_RANGE_INDEX',
      'ENGINE_RANGE_DOMAIN',
      'ENGINE_NOT_INDEXABLE',
      'ENGINE_NO_FIELD',
      'ENGINE_SYMBOL_NOT_EVALUABLE',
      'ENGINE_ARGS_INVALID',
      'ENGINE_NO_RECORD',
      'ENGINE_RECORD_DUPLICATE',
      'ENGINE_TOOL',
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
