import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseSkillFile } from '../src/skill.ts'

describe('parseSkillFile', () => {
  it('parses frontmatter metadata and the body', () => {
    const skill = parseSkillFile(
      [
        '---',
        'name: worked-solution',
        'description: "Worked solutions: analyse, plan, derive"',
        'whenToUse: "The user asks for a worked calculation"',
        '---',
        '# Worked Solution',
        '',
        'Some instructions.',
        '',
      ].join('\n'),
    )
    expect(skill.name).toBe('worked-solution')
    expect(skill.description).toBe('Worked solutions: analyse, plan, derive')
    expect(skill.whenToUse).toBe('The user asks for a worked calculation')
    expect(skill.content).toContain('# Worked Solution')
    expect(skill.content).toContain('Some instructions.')
  })

  it('raises when frontmatter is missing or incomplete', () => {
    expect(() => parseSkillFile('# No frontmatter')).toThrow(/missing YAML frontmatter/)
    expect(() => parseSkillFile('---\ndescription: only\n---\nbody')).toThrow(/needs name and description/)
  })

  it('parses the shipped template skill (format guard)', () => {
    const text = readFileSync(new URL('../skills/reckoner-template.md', import.meta.url), 'utf8')
    const skill = parseSkillFile(text)
    expect(skill.name).toBe('reckoner-template')
    expect(skill.description).toContain('record_question')
    expect(skill.whenToUse).toContain('reckoner workflow')
    expect(skill.content).toContain('## Record protocol')
  })

  it('parses the shipped interface skill (format guard)', () => {
    const text = readFileSync(new URL('../skills/reckoner-interface.md', import.meta.url), 'utf8')
    const skill = parseSkillFile(text)
    expect(skill.name).toBe('reckoner-interface')
    expect(skill.description).toContain('engine manual')
    expect(skill.whenToUse).toContain('engine')
    for (const section of ['## Values', '## Tools', '## Receipts and errors', '## Record markers', '## Notation', '## Dimensions', '## Discipline']) {
      expect(skill.content).toContain(section)
    }
  })
})
