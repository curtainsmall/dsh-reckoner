import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readState, STATE_FILE, statePath, updateState } from '../src/state.ts'

const homes: string[] = []

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'elab-state-'))
  homes.push(home)
  return home
}

afterEach(() => {
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true })
})

describe('state file', () => {
  it('reads a missing file as empty state', () => {
    const home = tempHome()
    expect(readState(home)).toEqual({})
    expect(statePath(home)).toBe(join(home, STATE_FILE))
  })

  it('reads a corrupt or non-object file as empty state', () => {
    const home = tempHome()
    writeFileSync(statePath(home), '{"generateDir":', 'utf8')
    expect(readState(home)).toEqual({})
    writeFileSync(statePath(home), '[1,2,3]', 'utf8')
    expect(readState(home)).toEqual({})
    writeFileSync(statePath(home), 'null', 'utf8')
    expect(readState(home)).toEqual({})
  })

  it('keeps the keys other writers own', () => {
    const home = tempHome()
    updateState(home, (state) => { state.restartRequired = true })
    updateState(home, (state) => { state.generateDir = 'D:/out' })
    updateState(home, (state) => { state.runs = [{ name: 'a.log' }] })
    expect(readState(home)).toEqual({ restartRequired: true, generateDir: 'D:/out', runs: [{ name: 'a.log' }] })
    // a writer may also delete its own key again
    updateState(home, (state) => { delete state.restartRequired })
    expect(readState(home)).toEqual({ generateDir: 'D:/out', runs: [{ name: 'a.log' }] })
  })

  it('replaces the file atomically, leaving no temporary behind', () => {
    const home = tempHome()
    updateState(home, (state) => { state.generateDir = 'D:/out' })
    expect(readFileSync(statePath(home), 'utf8')).toBe('{"generateDir":"D:/out"}')
    expect(readdirSync(home)).toEqual([STATE_FILE])
  })

  it('creates the home directory when it does not exist yet', () => {
    const home = join(tempHome(), 'nested', 'home')
    updateState(home, (state) => { state.restartRequired = false })
    expect(readState(home)).toEqual({ restartRequired: false })
  })
})
