/**
 * End to end: one realistic calculation through the whole host path — markers,
 * conditions, several `eval` steps, `get`, the record, and the article facts
 * built from the stored trace.
 *
 * This is the test that would have caught the solvers being half-removed: it
 * never touches an engine internal directly, only the tool-entry points the
 * model uses (`opSet` / `opGet` / `opEval` / the markers), plus the trace
 * reader the records panel and the article prompt share.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Engine } from '../src/engine/engine.ts'
import { recordFacts } from '../src/engine/record-facts.ts'
import { ArticleFormat, ArticleLanguage, buildArticlePrompt, renderRecordFacts } from '../src/generate.ts'

let home = ''

function makeEngine(): Engine {
  home = mkdtempSync(join(tmpdir(), 'reckoner-e2e-'))
  const engine = new Engine(home)
  engine.start()
  return engine
}

afterEach(() => {
  if (home.length > 0) rmSync(home, { recursive: true, force: true })
})

/** The facts of one stored record, exactly as the generation path builds them. */
function factsOf(engine: Engine, id: string): ReturnType<typeof recordFacts> {
  const meta = engine.indexRows().find((row) => row.id === id)
  if (meta === undefined) throw new Error('no record meta')
  return recordFacts(meta, engine.store.readRows(id))
}

describe('end to end: a three-step solve', () => {
  it('stores the conditions, derives each step, and rebuilds the facts from the trace', () => {
    const engine = makeEngine()
    expect(engine.markerQuestion('A 12 V source feeds 4.7 kohm in series with 220 ohm; what power can the load draw at most?')).toMatchObject({ ok: true })
    const id = String(engine.openId())

    // Conditions: the user's wording, one value string each.
    expect(engine.opSet('V_in', '12volt')).toMatchObject({ ok: true, rev: 1 })
    expect(engine.opSet('R1', '4.7kohm')).toMatchObject({ ok: true, rev: 1 })
    expect(engine.opSet('R2', '220ohm')).toMatchObject({ ok: true, rev: 1 })

    expect(engine.markerAnalyse('Thevenin: Vth = V_in*R2/(R1+R2), Rth = R1*R2/(R1+R2), Pmax = Vth^2/(4*Rth).')).toMatchObject({ ok: true })

    // Step 1: the divider. Split, because the same sub-expression shows up twice.
    expect(engine.opEval('@V_in*@R2/(@R1+@R2)', 'V_th')).toMatchObject({ ok: true, target: 'V_th', rev: 1 })
    // Step 2: the Thevenin resistance, so the next step can name it.
    expect(engine.opEval('@R1*@R2/(@R1+@R2)', 'R_th')).toMatchObject({ ok: true, target: 'R_th', rev: 1 })
    // Step 3: the power, from the two named intermediates.
    expect(engine.opEval('@V_th^2/(4*@R_th)', 'P_max')).toMatchObject({ ok: true, target: 'P_max', rev: 1 })

    // The derived kinds are the engine's, not the model's: ohm*ohm/ohm is an ohm.
    expect(engine.table.get('V_th')?.value).toMatchObject({ kind: 'voltage' })
    expect(engine.table.get('R_th')?.value).toMatchObject({ kind: 'resistance' })
    expect(engine.table.get('P_max')?.value).toMatchObject({ kind: 'power' })
    // The numbers: 12*220/4920 V, 4700*220/4920 ohm, V^2/(4R).
    const vth = 12 * (220 / 4920)
    const rth = 4700 * (220 / 4920)
    expect((engine.table.get('V_th')?.value as { value: number }).value).toBeCloseTo(vth, 12)
    expect((engine.table.get('R_th')?.value as { value: number }).value).toBeCloseTo(rth, 12)
    expect((engine.table.get('P_max')?.value as { value: number }).value).toBeCloseTo(vth ** 2 / (4 * rth), 12)

    // The model reads values with `get`, in a format it can feed back in.
    expect(engine.opGet('V_th', 'mvolt')).toMatchObject({ ok: true, value: expect.stringMatching(/^536\.58536585\d*mvolt$/) as unknown as string })
    expect(engine.opGet('R_th', 'ohm')).toMatchObject({ ok: true, value: expect.stringMatching(/^210\.16260162\d*ohm$/) as unknown as string })
    expect(engine.opGet('P_max', 'mwatt')).toMatchObject({ ok: true, value: expect.stringMatching(/^0\.3425\d*mwatt$/) as unknown as string })

    expect(engine.markerAnswer('The load can draw at most 0.343 mW.'))
    expect(engine.isOpen()).toBe(false)

    const facts = factsOf(engine, id)
    expect(facts.question).toContain('12 V source')
    expect(facts.answer).toBe('The load can draw at most 0.343 mW.')
    // Conditions are facts, so the article can state what was given.
    expect(facts.analyse).toContain('Established conditions:')
    expect(facts.analyse).toContain('V_in: {"type":"number","value":12,"kind":"voltage"}')
    expect(facts.analyse).toContain('Thevenin')
    // Three derivation steps, each with its formula, its substitution and its result.
    expect(facts.steps.map((step) => step.formula)).toEqual([
      '@V_in*@R2/(@R1+@R2)',
      '@R1*@R2/(@R1+@R2)',
      '@V_th^2/(4*@R_th)',
    ])
    expect(facts.steps[2]?.vars).toContain('"V_th"')
    expect(facts.steps[2]?.result).toContain('"kind":"power"')
  })

  it('feeds the record into the article prompt with formulas and results', () => {
    const engine = makeEngine()
    engine.markerQuestion('Resistor divider')
    const id = String(engine.openId())
    engine.opSet('V_in', '12volt')
    engine.opSet('R1', '4.7kohm')
    engine.opSet('R2', '220ohm')
    engine.markerAnalyse('Divider relation.')
    engine.opEval('@V_in*@R2/(@R1+@R2)', 'V_out')
    engine.markerAnswer('Vout is about 0.537 V.')

    const facts = factsOf(engine, id)
    const rendered = renderRecordFacts(facts)
    expect(rendered).toContain('Derivation step: @V_in*@R2/(@R1+@R2)')
    expect(rendered).toContain('result: {"type":"number","value":0.5365853658536586,"kind":"voltage"}')

    const prompt = buildArticlePrompt(facts, ArticleLanguage.ZhCN, ArticleFormat.Markdown)
    expect(prompt.system).toContain('DeepSeek Harness Reckoner')
    expect(prompt.system).toContain('Simplified Chinese')
    expect(prompt.user).toContain('@V_in*@R2/(@R1+@R2)')
    // The prompt never shows the record's internal row shape or the tool names.
    expect(prompt.user).not.toContain('record_question')
  })
})

describe('end to end: the engine refuses what it cannot check', () => {
  it('refuses a formula that adds a bare count to a quantity, and changes nothing', () => {
    const engine = makeEngine()
    engine.markerQuestion('q')
    engine.opSet('V_in', '12volt')
    expect(engine.opEval('5+@V_in', 'V_x')).toMatchObject({ ok: false, code: 'ENGINE_DIM_MISMATCH' })
    expect(engine.table.has('V_x')).toBe(false)
    expect(engine.table.get('V_in')?.rev).toBe(1)
    engine.markerAnswer('done')
  })

  it('refuses writing a current into a slot pinned to voltage', () => {
    const engine = makeEngine()
    engine.markerQuestion('q')
    engine.opSet('V', '12volt')
    engine.opSet('R', '4ohm')
    expect(engine.opEval('@V/@R', 'V')).toMatchObject({ ok: false, code: 'ENGINE_DIM_MISMATCH' })
    expect(engine.table.get('V')?.value).toMatchObject({ value: 12, kind: 'voltage' })
    engine.markerAnswer('done')
  })

  it('survives a restart: the same record continues and its steps replay from the trace', () => {
    const engine = makeEngine()
    engine.markerQuestion('q')
    engine.opSet('V_in', '12volt')
    engine.opSet('R1', '4.7kohm')
    engine.opSet('R2', '220ohm')
    engine.opEval('@V_in*@R2/(@R1+@R2)', 'V_th')
    const id = String(engine.openId())

    const revived = new Engine(home)
    revived.start()
    expect(revived.openId()).toBe(id)
    expect(revived.isOpen()).toBe(true)
    // Slots come back from the stored rows, not from recomputation.
    expect(revived.table.get('V_th')?.value).toMatchObject({ kind: 'voltage' })
    // The record can be continued: one more step, then the answer.
    expect(revived.opEval('@V_th/@R1', 'I')).toMatchObject({ ok: true, rev: 1 })
    expect(revived.markerAnswer('continued')).toMatchObject({ ok: true, record: id })
    expect(revived.isOpen()).toBe(false)
  })
})
