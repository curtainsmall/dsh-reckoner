/**
 * The generation module's own contract: the prompt built from the record
 * facts, and the LaTeX shell around a model-written body.
 */
import { describe, expect, it } from 'vitest'
import {
  ArticleFormat,
  ArticleLanguage,
  TemplateLanguage,
  buildArticlePrompt,
  buildLatexDocument,
  normalizeFileName,
  renderRecordFacts,
  resolveTemplateLanguage,
  sanitizeLatexBody,
  type GenerationFacts,
} from '../src/generate.ts'

const FACTS: GenerationFacts = {
  title: 'The current through R2',
  conditions: [
    { name: 'V_in', value: { num: 12, dim: [2, 1, -3, -1, 0, 0, 0] } },
    { name: 'R2', value: { num: 220, dim: [2, 1, -3, -2, 0, 0, 0] } },
  ],
  messages: [
    { seq: 4, text: 'Ohm law: I = V / R', hide: false },
    { seq: 5, text: 'Use the amplitude convention (20) throughout.', hide: true },
  ],
  steps: [
    {
      seq: 6,
      formula: '@V_in/@R2',
      vars: { V_in: { num: 12, dim: [2, 1, -3, -1, 0, 0, 0] }, R2: { num: 220, dim: [2, 1, -3, -2, 0, 0, 0] } },
      result: { num: 0.05454545454545454, dim: [0, 0, 0, 1, 0, 0, 0] },
    },
  ],
  closing: 'I = 54.5 mA',
}

describe('the facts text', () => {
  it('spells the title, the conditions, the messages, the steps and the closing text', () => {
    const text = renderRecordFacts(FACTS)
    expect(text).toContain('The current through R2')
    expect(text).toContain('V_in')
    expect(text).toContain('{"num":12,"dim":[2,1,-3,-1,0,0,0]}')
    expect(text).toContain('Ohm law: I = V / R')
    expect(text).toContain('@V_in/@R2')
    expect(text).toContain('substituting: V_in = {"num":12,')
    // Numbers reach the writer cut to four decimal places, dims untouched.
    expect(text).toContain('result: {"num":0.0545,"dim":[0,0,0,1,0,0,0]}')
    expect(text).not.toContain('0.05454545454545454')
    expect(text).toContain('I = 54.5 mA')
    expect(text).toContain('m, kg, s, A, K, mol, cd')
    expect(text).toContain('never add digits and never recompute')
  })

  it('keeps the record timeline in seq order, with each message beside its steps', () => {
    const text = renderRecordFacts(FACTS)
    const explanationAt = text.indexOf("The record's own explanation: Ohm law")
    const noteAt = text.indexOf("The author's note at step 5")
    const stepAt = text.indexOf('- Step 6: @V_in/@R2')
    expect(explanationAt).toBeGreaterThan(-1)
    expect(noteAt).toBeGreaterThan(explanationAt)
    expect(stepAt).toBeGreaterThan(noteAt)
    expect(text).not.toContain('Derivation step')
  })

  it("marks a hidden message as the author's note, in its own place", () => {
    const text = renderRecordFacts(FACTS)
    expect(text).toContain("The author's note at step 5")
    expect(text).toContain('never copy it, never quote it')
    expect(text).toContain('Use the amplitude convention (20) throughout.')
    expect(text).not.toContain("The record's own explanation: Use the amplitude convention")
  })

  it('omits what the record does not have', () => {
    const text = renderRecordFacts({ title: 'q', conditions: [], messages: [], steps: [], closing: null })
    expect(text).toContain('q')
    expect(text).not.toContain('Step ')
    expect(text).not.toContain('closing text')
    expect(text).not.toContain("author's note")
  })
})

describe('the article prompt', () => {
  it('carries the facts and the format-specific rules', () => {
    const markdown = buildArticlePrompt(FACTS, ArticleLanguage.Auto, ArticleFormat.Markdown)
    expect(markdown.user).toContain('The current through R2')
    expect(markdown.user).toContain('I = 54.5 mA')
    expect(markdown.system).toContain('DeepSeek Harness Reckoner Solution')
    expect(markdown.system).toContain('Use the recorded title as the article title')
    expect(markdown.system).toContain('never invent or recompute values')

    const latex = buildArticlePrompt(FACTS, ArticleLanguage.Auto, ArticleFormat.Latex)
    expect(latex.system).toContain('LaTeX article body')
    expect(latex.system).toContain('\\documentclass')
  })

  it("gives the hidden messages to the writer but keeps them out of the article", () => {
    const prompt = buildArticlePrompt(FACTS, ArticleLanguage.Auto, ArticleFormat.Markdown)
    expect(prompt.user).toContain("The author's note at step 5")
    expect(prompt.user).toContain('Use the amplitude convention (20) throughout.')
    expect(prompt.system).toContain("the author's notes in the article")
  })

  it('pins the article language when one is chosen', () => {
    const forced = buildArticlePrompt(FACTS, ArticleLanguage.ZhCN, ArticleFormat.Markdown)
    expect(forced.system).toContain('Simplified Chinese')
    expect(forced.user).toContain('Simplified Chinese')
  })
})

describe('the output file', () => {
  it('forces the extension of the chosen format', () => {
    expect(normalizeFileName('reckoner-abc.md', ArticleFormat.Latex)).toBe('reckoner-abc.tex')
    expect(normalizeFileName('reckoner-abc.tex', ArticleFormat.Markdown)).toBe('reckoner-abc.md')
    expect(normalizeFileName('   ', ArticleFormat.Markdown)).toBe('reckoner-article.md')
  })

  it('probes the question language when the choice is automatic', () => {
    expect(resolveTemplateLanguage(ArticleLanguage.Auto, '电阻是多少？')).toBe(TemplateLanguage.ZhCN)
    expect(resolveTemplateLanguage(ArticleLanguage.Auto, 'what is the resistance?')).toBe(TemplateLanguage.En)
    expect(resolveTemplateLanguage(ArticleLanguage.En, '电阻是多少？')).toBe(TemplateLanguage.En)
  })
})

describe('the LaTeX document', () => {
  it('wraps a body in the shell of the resolved language', () => {
    const built = buildLatexDocument('\\section{Answer}\n$I = 54.5$ mA', TemplateLanguage.ZhCN)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.text).toContain('\\documentclass{ctexart}')
    expect(built.text).toContain('\\title{DeepSeek Harness Reckoner Solution}')
    expect(built.text).toContain('\\section{Answer}')
    expect(built.text.trimEnd().endsWith('\\end{document}')).toBe(true)
  })

  it('refuses a body that restructures the document, and escapes a bare percent', () => {
    expect(sanitizeLatexBody('\\documentclass{article}').ok).toBe(false)
    expect(sanitizeLatexBody('50 % of the load').ok).toBe(true)
    const escaped = sanitizeLatexBody('50 % of the load')
    expect(escaped.ok && escaped.body).toBe('50 \\% of the load')
    expect(sanitizeLatexBody('{ unbalanced').ok).toBe(false)
    expect(buildLatexDocument('   ', TemplateLanguage.En).ok).toBe(false)
  })
})
