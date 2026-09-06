/**
 * Markdown article generator tests: the article frame (fixed title/byline),
 * problem header, alternating analysis/calculation steps with input lists,
 * result → slot handover used as the premise of the next analysis, structured
 * (JSON) values as fenced blocks, dropped conditions, and the conclusion.
 */
import { describe, expect, it } from 'vitest'
import { buildMarkdownArticle, type ArticleSource } from '../src/client/article-md.ts'

function body(rows: ArticleSource['rows']): ArticleSource {
  return { id: 'rec-1', question: 'Compute the impedance of an RC series circuit at 1 kHz.', rows }
}

function row(partial: Record<string, unknown>): Record<string, unknown> {
  return { seq: 1, ok: true, at: 0, ...partial }
}

describe('buildMarkdownArticle', () => {
  it('emits the fixed frame, problem and verbatim analysis/conclusion texts', () => {
    const source = body([
      row({ tool: 'marker', kind: 'question', text: 'Compute the impedance of an RC series circuit at 1 kHz.' }),
      row({ tool: 'marker', kind: 'analyse', text: 'First resolve the reactance of the capacitor at 1 kHz.' }),
      row({ tool: 'marker', kind: 'answer', text: 'The impedance is 1592 Ω.' }),
    ])
    const md = buildMarkdownArticle(source)
    expect(md).toContain('# DeepSeek Harness ElectroLab Solution')
    expect(md).toContain('*Author: DeepSeek Harness ElectroLab*')
    expect(md).toContain('## Problem')
    expect(md).toContain('> Compute the impedance of an RC series circuit at 1 kHz.')
    expect(md).toContain('### Step 1 · Analysis')
    expect(md).toContain('First resolve the reactance of the capacitor at 1 kHz.')
    expect(md).toContain('## Conclusion')
    expect(md).toContain('The impedance is 1592 Ω.')
  })

  it('walks set and call rows in order and hands the result to the next analysis', () => {
    const source = body([
      row({ tool: 'set', name: 'R', value: { type: 'number', value: 100, kind: 'resistance' }, rev: 1 }),
      row({
        tool: 'call',
        solver: 'series_impedance',
        target: 'Z',
        rev: 1,
        args: { R: { type: 'slot', value: 'R' } },
        resolved: { R: { type: 'number', value: 100, kind: 'resistance' } },
        result: { type: 'complex', kind: 'resistance', value: { re: 100, im: -1592 } },
      }),
      row({ tool: 'marker', kind: 'analyse', text: 'Next, examine the phase angle from the reactance.' }),
    ])
    const md = buildMarkdownArticle(source)
    // Step numbering keeps trace order.
    expect(md).toContain('### Step 1 · Given: R')
    expect(md).toContain('`R` = `100 Ω`')
    expect(md).toContain('### Step 2 · `series_impedance`')
    expect(md).toContain('**Inputs**')
    expect(md).toContain('- `R`: `100 Ω`')
    expect(md).toContain('**Result**: `Z` = `100 − j1592 Ω`')
    // The analysis after the calculation is framed with the previous result.
    expect(md).toContain('### Step 3 · Analysis — given `Z` = `100 − j1592 Ω`')
    expect(md).toContain('Next, examine the phase angle from the reactance.')
  })

  it('renders structured results as JSON blocks and notes dropped conditions', () => {
    const source = body([
      row({
        tool: 'call',
        solver: 'signal_analysis',
        target: 'spectrum',
        args: {},
        result: { type: 'object', value: { peak: 3.3, bins: [1, 2] } },
      }),
      row({ tool: 'set', name: 'spectrum', deleted: true, rev: 2 }),
    ])
    const md = buildMarkdownArticle(source)
    expect(md).toContain('```json')
    expect(md).toContain('"peak": 3.3')
    expect(md).toContain('> The condition `spectrum` is dropped from this point on.')
  })

  it('skips failed attempts and introspection rows', () => {
    const source = body([
      row({ tool: 'call', solver: 'bad', ok: false, args: {}, result: null }),
      row({ tool: 'solver_info', solver: 'bad', ok: true }),
      row({ tool: 'marker', kind: 'analyse', text: 'Only this survives.' }),
    ])
    const md = buildMarkdownArticle(source)
    expect(md).not.toContain('bad')
    expect(md).toContain('Only this survives.')
  })
})
