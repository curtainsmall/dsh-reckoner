/**
 * LaTeX article renderer tests: document frame with the fixed title/byline,
 * ASCII-safe escaping (special characters, unit glyphs → math), step headings,
 * named-condition handover, JSON payloads as verbatim blocks and the
 * conclusion section.
 */
import { describe, expect, it } from 'vitest'
import { buildLatexArticle, type ArticleSource } from '../src/client/article-tex.ts'

function body(rows: ArticleSource['rows']): ArticleSource {
  return { id: 'rec-1', question: 'Compute the impedance of an RC series circuit at 1 kHz.', rows }
}

function row(partial: Record<string, unknown>): Record<string, unknown> {
  return { seq: 1, ok: true, at: 0, ...partial }
}

describe('buildLatexArticle', () => {
  it('emits a compiling frame with the fixed title/byline and sections', () => {
    const source = body([
      row({ tool: 'marker', kind: 'analyse', text: 'First resolve the reactance at 1 kHz.' }),
      row({ tool: 'marker', kind: 'answer', text: 'The impedance is 1592 Ω.' }),
    ])
    const tex = buildLatexArticle(source)
    expect(tex).toContain('\\documentclass[11pt]{article}')
    expect(tex).toContain('\\title{\\textbf{DeepSeek Harness ElectroLab Solution}}')
    expect(tex).toContain('\\author{DeepSeek Harness ElectroLab}')
    expect(tex).toContain('\\begin{document}')
    expect(tex).toContain('\\section*{Problem}')
    expect(tex).toContain('\\subsection*{Step 1 -- Analysis}')
    expect(tex).toContain('First resolve the reactance at 1 kHz.')
    expect(tex).toContain('\\section*{Conclusion}')
    expect(tex).toContain('The impedance is 1592 $\\Omega$.')
    expect(tex).toContain('\\end{document}')
  })

  it('escapes LaTeX special characters and unit glyphs into ASCII math', () => {
    const source = body([
      row({ tool: 'marker', kind: 'analyse', text: 'R & C: 50% of $5 with 100 Ω and 2 µF.' }),
    ])
    const tex = buildLatexArticle(source)
    expect(tex).not.toContain('R & C')
    expect(tex).toContain('R \\& C: 50\\% of \\$5 with 100 $\\Omega$ and 2 $\\mu$F.')
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
      row({ tool: 'marker', kind: 'analyse', text: 'Next, examine the phase angle.' }),
    ])
    const tex = buildLatexArticle(source)
    expect(tex).toContain('\\subsection*{Step 1 -- Given: \\texttt{R}}')
    expect(tex).toContain('\\texttt{R} = 100 $\\Omega$')
    expect(tex).toContain('\\subsection*{Step 2 -- \\texttt{series\\_impedance}}')
    expect(tex).toContain('\\textbf{Inputs:}')
    expect(tex).toContain('\\item \\texttt{R}: 100 $\\Omega$')
    expect(tex).toContain('\\textbf{Result:} \\texttt{Z} = 100 $-$ j1592 $\\Omega$')
    // The following analysis is framed with the previous result.
    expect(tex).toContain('\\subsection*{Step 3 -- Analysis}')
    expect(tex).toContain('\\emph{given \\texttt{Z} = 100 $-$ j1592 $\\Omega$}')
    expect(tex).toContain('Next, examine the phase angle.')
  })

  it('renders structured results as verbatim JSON and notes dropped conditions', () => {
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
    const tex = buildLatexArticle(source)
    expect(tex).toContain('\\begin{verbatim}')
    expect(tex).toContain('"peak": 3.3')
    expect(tex).toContain('\\emph{The condition \\texttt{spectrum} is dropped from this point on.}')
  })

  it('skips failed attempts and introspection rows', () => {
    const source = body([
      row({ tool: 'call', solver: 'bad', ok: false, args: {}, result: null }),
      row({ tool: 'solver_info', solver: 'bad', ok: true }),
      row({ tool: 'marker', kind: 'analyse', text: 'Only this survives.' }),
    ])
    const tex = buildLatexArticle(source)
    expect(tex).not.toContain('bad')
    expect(tex).toContain('Only this survives.')
  })
})
